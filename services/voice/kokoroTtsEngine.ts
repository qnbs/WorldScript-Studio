/**
 * KokoroTtsEngine — local text-to-speech via @huggingface/transformers v3 (Kokoro-82M, ONNX).
 * QNBS-v3: Phase 3 — high-quality local TTS; gated behind enableVoiceWasm flag.
 *          Kokoro TTS is supported by transformers.js v3.3+ via the text-to-speech pipeline.
 * Falls back to Web Speech API if model load fails.
 */

import type { VoiceTtsEngine } from '../../types';
import { logger } from '../logger';
import type { TtsEngine, TtsUtterance } from './voiceTypes';

// @huggingface/transformers types — Kokoro text-to-speech returns { audio, sampling_rate }
type TtsPipelineResult = { audio: Float32Array; sampling_rate: number };
type TtsPipeline = (text: string, opts: Record<string, unknown>) => Promise<TtsPipelineResult>;

export class KokoroTtsEngine implements TtsEngine {
  readonly id: VoiceTtsEngine = 'kokoro';
  readonly name = 'Kokoro TTS (local ONNX)';
  readonly isLocal = true;

  private ttsPipeline: TtsPipeline | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private resolveCurrent: (() => void) | null = null;

  async isAvailable(): Promise<boolean> {
    if (typeof WebAssembly === 'undefined') return false;
    if (typeof AudioContext === 'undefined') return false;
    try {
      const { pipeline } = await import('@huggingface/transformers');
      return typeof pipeline === 'function';
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    const { pipeline, env } = await import('@huggingface/transformers');
    interface XenovaEnv {
      backends?: { onnx?: { wasm?: { proxy?: boolean } } };
    }
    const typedEnv = env as unknown as XenovaEnv;
    if (typedEnv.backends?.onnx?.wasm) {
      typedEnv.backends.onnx.wasm.proxy = false;
    }
    // QNBS-v3: correct onnx-community model ID (617K downloads, style_text_to_speech_2 arch).
    this.ttsPipeline = (await pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      // QNBS-v3: cast via unknown — the v3 TextToAudioPipeline union doesn't structurally overlap our TtsPipeline fn type.
    })) as unknown as TtsPipeline;
    logger.info('[KokoroTtsEngine] TTS pipeline ready');
  }

  async speak(utterance: TtsUtterance): Promise<void> {
    if (!this.ttsPipeline) {
      throw new Error('Kokoro TTS not initialized');
    }

    this.cancel();

    const result = await this.ttsPipeline(utterance.text, {
      voice: 'af_bella',
    });

    this.audioContext = new AudioContext({ sampleRate: result.sampling_rate });
    const buffer = this.audioContext.createBuffer(1, result.audio.length, result.sampling_rate);
    buffer.getChannelData(0).set(result.audio);

    return new Promise((resolve) => {
      this.resolveCurrent = resolve;
      this.currentSource = this.audioContext!.createBufferSource();
      this.currentSource.buffer = buffer;

      // Volume control via GainNode
      const gain = this.audioContext!.createGain();
      gain.gain.value = utterance.volume ?? 1.0;
      this.currentSource.connect(gain);
      gain.connect(this.audioContext!.destination);

      // Playback rate control
      this.currentSource.playbackRate.value = utterance.rate ?? 1.0;

      this.currentSource.onended = () => {
        this.resolveCurrent?.();
        this.resolveCurrent = null;
        this.currentSource = null;
      };

      this.currentSource.start();
    });
  }

  cancel(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // ignore stop-on-already-ended
      }
      this.currentSource = null;
    }
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }

  pause(): void {
    this.audioContext?.suspend();
  }

  resume(): void {
    this.audioContext?.resume();
  }

  async dispose(): Promise<void> {
    this.cancel();
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    this.ttsPipeline = null;
  }
}
