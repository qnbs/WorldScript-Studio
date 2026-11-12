/**
 * KokoroTtsEngine — local text-to-speech with Kokoro-82M (ONNX); gated behind the enableVoiceWasm flag.
 * Not available in this build: the bundled Transformers.js text-to-speech pipeline rejects Kokoro's model type
 * (style_text_to_speech_2), and Kokoro also needs a phonemizer the app does not ship. The factory then uses the system voice.
 */

import type { VoiceTtsEngine } from '../../types';
import { logger } from '../logger';
import type { TtsEngine, TtsUtterance } from './voiceTypes';

// @huggingface/transformers types — Kokoro text-to-speech returns { audio, sampling_rate }
type TtsPipelineResult = { audio: Float32Array; sampling_rate: number };
type TtsPipeline = (text: string, opts: Record<string, unknown>) => Promise<TtsPipelineResult>;

/** Why Kokoro cannot run in this build; logged on fallback and returned by the TTS model download. */
export const KOKORO_UNAVAILABLE_REASON =
  'Kokoro TTS is not available in this version: its model type (style_text_to_speech_2) needs a phonemizer and model loader that this build does not include.';

export class KokoroTtsEngine implements TtsEngine {
  readonly id: VoiceTtsEngine = 'kokoro';
  readonly name = 'Kokoro TTS (local ONNX)';
  readonly isLocal = true;

  private ttsPipeline: TtsPipeline | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private resolveCurrent: (() => void) | null = null;

  // QNBS-v3 (#556): truthful availability; every real-runtime evidence run failed with "Unsupported model type style_text_to_speech_2".
  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async initialize(): Promise<void> {
    const { pipeline, env } = await import('../../packages/ai-core/src/vendor-transformers');
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
