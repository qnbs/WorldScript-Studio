/**
 * STT Engine implementations with Web Speech API fallback.
 * QNBS-v3: Abstract interface allows future Whisper.cpp / Sherpa-ONNX integration.
 */

import type { VoiceSttEngine } from '../../types';
import { logger } from '../logger';
import { getVoiceTestHarness } from './voiceTestSeam';
import type { AudioStreamConfig, SttEngine, SttResult } from './voiceTypes';

/** Thrown when Web Speech API is requested but the user has not granted GDPR Art. 13 consent. */
export class ConsentRequiredError extends Error {
  constructor() {
    super(
      'Web Speech API requires explicit consent before use — audio is routed to cloud STT providers.',
    );
    this.name = 'ConsentRequiredError';
  }
}

// ── Web Speech API Implementation ────────────────────────────────────────────

// QNBS-v3: DOM lib may not expose SpeechRecognition constructor on Window.
// We use type assertions to access the non-standard API.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export class WebSpeechSttEngine implements SttEngine {
  readonly id: VoiceSttEngine = 'webSpeech';
  readonly name = 'Web Speech API';
  readonly isLocal = false;
  readonly supportsStreaming = true;

  private recognition: SpeechRecognitionLike | null = null;
  private onResultCallback: ((result: SttResult) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  private isRunning = false;
  // QNBS-v3: GDPR Art. 13 — Web Speech API routes audio to cloud providers; consent required.
  private readonly consentGranted: boolean;

  constructor(consentGranted = false) {
    this.consentGranted = consentGranted;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(
      typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    );
  }

  async initialize(): Promise<void> {
    // QNBS-v3: Block initialization if user has not consented to cloud audio routing.
    if (!this.isLocal && !this.consentGranted) {
      throw new ConsentRequiredError();
    }
  }

  async start(
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      throw new Error('Web Speech API not supported in this browser');
    }

    this.recognition = new SpeechRecognitionCtor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = document.documentElement.lang || 'en-US';

    this.onResultCallback = onResult;
    this.onErrorCallback = onError;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const lastResult = event.results[event.results.length - 1];
      if (!lastResult) return;

      const alt = lastResult[0];
      if (!alt) return;
      const transcript = alt.transcript;
      const confidence = alt.confidence ?? 0.8;
      const isFinal = lastResult.isFinal;

      this.onResultCallback?.({ transcript, isFinal, confidence });
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.onErrorCallback?.(new Error(`Speech recognition error: ${event.error}`));
    };

    this.recognition.onend = () => {
      if (this.isRunning) {
        // Auto-restart if we're still supposed to be listening
        try {
          this.recognition?.start();
        } catch {
          this.isRunning = false;
        }
      }
    };

    this.isRunning = true;
    this.recognition.start();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    try {
      this.recognition?.stop();
    } catch {
      // Ignore errors during stop
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.recognition = null;
    this.onResultCallback = null;
    this.onErrorCallback = null;
  }
}

// ── Stt Engine Factory ───────────────────────────────────────────────────────

export interface SttEngineFactoryOptions {
  preferredEngine?: VoiceSttEngine;
  config?: AudioStreamConfig;
  /** GDPR Art. 13 consent for Web Speech API cloud audio routing — must be true to use webSpeech engine. */
  webSpeechConsentGranted?: boolean;
  /** When true, tries WasmSttEngine (Whisper) before falling back to Web Speech API. */
  enableVoiceWasm?: boolean;
  /** settings.voice.allowCloudSttFallback: an explicit on-device choice may fall back to cloud recognition only when true. */
  allowCloudFallback?: boolean;
}

/** Thrown instead of silently switching an explicit on-device choice to cloud recognition (#1261). */
export const LOCAL_STT_UNAVAILABLE_MESSAGE =
  'Local speech recognition is not available, and cloud fallback is turned off.';

// QNBS-v3: Dynamically import WasmSttEngine — keeps Whisper/ONNX out of main bundle.
async function loadWasmSttEngine(config: AudioStreamConfig | undefined): Promise<SttEngine | null> {
  try {
    const { WasmSttEngine } = await import('./wasmSttEngine');
    return new WasmSttEngine(config);
  } catch (err) {
    logger.warn('[createSttEngine] WasmSttEngine load failed, falling back:', err);
    return null;
  }
}

/** The explicitly preferred engine, or null to try the fallbacks. */
async function explicitSttEngine(
  engines: SttEngine[],
  preferredEngine: VoiceSttEngine,
  allowCloudFallback: boolean,
): Promise<SttEngine | null> {
  const preferred = engines.find((e) => e.id === preferredEngine);
  if (preferred && (await preferred.isAvailable())) return preferred;
  logger.warn(`Preferred STT engine ${preferredEngine} unavailable, trying fallbacks`);
  // QNBS-v3 (#1261): the user chose on-device recognition; never send that audio to a cloud engine unless they allowed it.
  if (preferredEngine === 'whisper' && !allowCloudFallback)
    throw new Error(LOCAL_STT_UNAVAILABLE_MESSAGE);
  return null;
}

async function firstAvailable(engines: SttEngine[]): Promise<SttEngine | null> {
  for (const engine of engines) {
    if (await engine.isAvailable()) return engine;
  }
  return null;
}

export async function createSttEngine(options: SttEngineFactoryOptions = {}): Promise<SttEngine> {
  // QNBS-v3: P1-2 — E2E seam. Returns the injected mock STT verbatim (undefined in production).
  const harness = getVoiceTestHarness();
  if (harness?.stt) {
    logger.info('[createSttEngine] using injected test STT engine');
    return harness.stt;
  }

  const preferredEngine = options.preferredEngine ?? 'auto';
  const engines: SttEngine[] = [];
  if (options.enableVoiceWasm && preferredEngine !== 'webSpeech') {
    const wasm = await loadWasmSttEngine(options.config);
    if (wasm) engines.push(wasm);
  }
  engines.push(new WebSpeechSttEngine(options.webSpeechConsentGranted === true));

  const selected =
    (preferredEngine === 'auto'
      ? null
      : await explicitSttEngine(engines, preferredEngine, options.allowCloudFallback === true)) ??
    (await firstAvailable(engines));
  if (!selected) throw new Error('No STT engine available');
  logger.info(`STT engine selected: ${selected.name}`);
  return selected;
}
