/**
 * STT Engine implementations with Web Speech API fallback.
 * QNBS-v3: Abstract interface allows future Whisper.cpp / Sherpa-ONNX integration.
 */

import type { VoiceSttEngine } from '../../types';
import { logger } from '../logger';
import type { AudioStreamConfig, SttEngine, SttResult } from './voiceTypes';

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

  isAvailable(): Promise<boolean> {
    return Promise.resolve(
      typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    );
  }

  async initialize(): Promise<void> {
    // Web Speech API requires no initialization
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
}

export async function createSttEngine(options: SttEngineFactoryOptions = {}): Promise<SttEngine> {
  const { preferredEngine = 'auto' } = options;

  // QNBS-v3: In Phase 1 only Web Speech API is implemented.
  // Future phases add Whisper.cpp WASM and Sherpa-ONNX engines.
  const engines: SttEngine[] = [new WebSpeechSttEngine()];

  if (preferredEngine !== 'auto') {
    const preferred = engines.find((e) => e.id === preferredEngine);
    if (preferred && (await preferred.isAvailable())) {
      logger.info(`STT engine selected: ${preferred.name}`);
      return preferred;
    }
    logger.warn(`Preferred STT engine ${preferredEngine} unavailable, trying fallbacks`);
  }

  for (const engine of engines) {
    if (await engine.isAvailable()) {
      logger.info(`STT engine selected: ${engine.name}`);
      return engine;
    }
  }

  throw new Error('No STT engine available');
}
