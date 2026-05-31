/**
 * TTS Engine implementations with Web Speech API fallback.
 * QNBS-v3: Future phases add Kokoro (ONNX) and Piper WASM engines.
 */

import type { VoiceTtsEngine } from '../../types';
import { logger } from '../logger';
import type { TtsEngine, TtsUtterance } from './voiceTypes';

// ── Web Speech API Implementation ────────────────────────────────────────────

export class WebSpeechTtsEngine implements TtsEngine {
  readonly id: VoiceTtsEngine = 'webSpeech';
  readonly name = 'Web Speech API';
  readonly isLocal = false;

  private resolveCurrent: (() => void) | null = null;
  private rejectCurrent: ((err: Error) => void) | null = null;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }

  async initialize(): Promise<void> {
    // Pre-load voices to avoid first-speak delay
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }

  speak(utterance: TtsUtterance): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        reject(new Error('Speech synthesis not available'));
        return;
      }

      this.cancel();
      this.resolveCurrent = resolve;
      this.rejectCurrent = reject;

      const u = new SpeechSynthesisUtterance(utterance.text);
      u.rate = utterance.rate ?? 1.0;
      u.volume = utterance.volume ?? 1.0;
      u.pitch = utterance.pitch ?? 1.0;
      u.lang = utterance.language ?? document.documentElement.lang ?? 'en-US';

      // Try to find a good voice
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find((v) => v.default) ?? voices[0];
      if (preferredVoice) {
        u.voice = preferredVoice;
      }

      u.onend = () => {
        this.resolveCurrent?.();
        this.resolveCurrent = null;
        this.rejectCurrent = null;
      };

      u.onerror = (event) => {
        const err = new Error(`TTS error: ${event.error}`);
        this.rejectCurrent?.(err);
        this.resolveCurrent = null;
        this.rejectCurrent = null;
      };

      window.speechSynthesis.speak(u);
    });
  }

  cancel(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.resolveCurrent = null;
    this.rejectCurrent = null;
  }

  pause(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.resume();
    }
  }

  async dispose(): Promise<void> {
    this.cancel();
  }
}

// ── TTS Engine Factory ───────────────────────────────────────────────────────

export interface TtsEngineFactoryOptions {
  preferredEngine?: VoiceTtsEngine;
  /** QNBS-v3: When true, prefers Kokoro ONNX over Web Speech API. */
  enableVoiceWasm?: boolean;
}

export async function createTtsEngine(options: TtsEngineFactoryOptions = {}): Promise<TtsEngine> {
  const { preferredEngine = 'auto', enableVoiceWasm = false } = options;

  const engines: TtsEngine[] = [new WebSpeechTtsEngine()];

  // QNBS-v3: Try Kokoro first when WASM voice is enabled and preference is auto/kokoro.
  if (enableVoiceWasm && (preferredEngine === 'auto' || preferredEngine === 'kokoro')) {
    try {
      const { KokoroTtsEngine } = await import('./kokoroTtsEngine');
      const kokoro = new KokoroTtsEngine();
      if (await kokoro.isAvailable()) {
        await kokoro.initialize();
        logger.info(`TTS engine selected: ${kokoro.name}`);
        return kokoro;
      }
    } catch (err) {
      logger.warn('[createTtsEngine] Kokoro unavailable, falling back:', err);
    }
  }

  if (preferredEngine !== 'auto') {
    const preferred = engines.find((e) => e.id === preferredEngine);
    if (preferred && (await preferred.isAvailable())) {
      logger.info(`TTS engine selected: ${preferred.name}`);
      return preferred;
    }
    logger.warn(`Preferred TTS engine ${preferredEngine} unavailable, trying fallbacks`);
  }

  for (const engine of engines) {
    if (await engine.isAvailable()) {
      logger.info(`TTS engine selected: ${engine.name}`);
      return engine;
    }
  }

  throw new Error('No TTS engine available');
}
