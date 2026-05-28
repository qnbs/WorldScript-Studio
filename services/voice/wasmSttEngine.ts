/**
 * WasmSttEngine — local Whisper STT via @xenova/transformers (whisper-tiny.en, Q8 quantized).
 * QNBS-v3: Phase 2 B-2 — eliminates cloud audio routing; gated behind enableVoiceWasm flag.
 * Audio capture: getUserMedia → MediaRecorder → decodeAudioData → Float32Array → Whisper pipeline.
 */

import type { VoiceSttEngine } from '../../types';
import { logger } from '../logger';
import type { AudioStreamConfig, SttEngine, SttResult } from './voiceTypes';
import { DEFAULT_AUDIO_CONFIG } from './voiceTypes';

const MODEL_ID = 'Xenova/whisper-tiny.en';
// Transcribe every N ms of recorded audio
const TRANSCRIPTION_INTERVAL_MS = 3_500;

// @xenova/transformers types (imported via alias in vite.config.ts + tsconfig paths)
type WhisperPipelineResult = { text?: string } | Array<{ text?: string }>;
type WhisperPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<WhisperPipelineResult>;

export class WasmSttEngine implements SttEngine {
  readonly id: VoiceSttEngine = 'whisper';
  readonly name = 'Whisper Tiny (local WASM)';
  readonly isLocal = true;
  readonly supportsStreaming = false;

  private whisperPipeline: WhisperPipeline | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private pendingBlobs: Blob[] = [];
  private transcribeTimer: ReturnType<typeof setInterval> | null = null;
  private onResultCallback: ((result: SttResult) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  private isRunning = false;
  // QNBS-v3: Separate disposed flag — isRunning is set false during stop() but we still want to drain.
  private isDisposed = false;
  private readonly config: AudioStreamConfig;

  constructor(config: AudioStreamConfig = DEFAULT_AUDIO_CONFIG) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (typeof WebAssembly === 'undefined') return false;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    return true;
  }

  async initialize(): Promise<void> {
    // QNBS-v3: Dynamic import keeps @xenova/transformers in vendor-ai-onnx chunk, not main bundle.
    const { pipeline, env } = await import('@xenova/transformers');
    // Disable WASM proxy — run inline; proxy adds latency and SharedArrayBuffer dependency.
    interface XenovaEnv {
      backends?: { onnx?: { wasm?: { proxy?: boolean } } };
    }
    const typedEnv = env as unknown as XenovaEnv;
    if (typedEnv.backends?.onnx?.wasm) {
      typedEnv.backends.onnx.wasm.proxy = false;
    }
    this.whisperPipeline = (await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
    })) as WhisperPipeline;
    logger.info('[WasmSttEngine] Whisper pipeline ready');
  }

  async start(
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    this.onResultCallback = onResult;
    this.onErrorCallback = onError;
    this.pendingBlobs = [];
    this.isRunning = true;
    this.isDisposed = false;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      this.isRunning = false;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Microphone access denied: ${msg}`);
    }

    this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });

    // Use MediaRecorder to avoid deprecated createScriptProcessor.
    // QNBS-v3: MediaRecorder produces encoded blobs; decodeAudioData converts to PCM for Whisper.
    this.recorder = new MediaRecorder(this.mediaStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0 && this.isRunning) {
        this.pendingBlobs.push(event.data);
      }
    };

    this.recorder.start(TRANSCRIPTION_INTERVAL_MS);

    // Drain pending blobs every interval
    this.transcribeTimer = setInterval(() => {
      void this.drainAndTranscribe();
    }, TRANSCRIPTION_INTERVAL_MS + 200);
  }

  private async drainAndTranscribe(): Promise<void> {
    // QNBS-v3: Check isDisposed (not isRunning) — stop() sets isRunning=false but still drains remaining blobs.
    if (!this.whisperPipeline || this.pendingBlobs.length === 0 || this.isDisposed) return;

    const blobs = this.pendingBlobs.splice(0);
    const blob = new Blob(blobs, { type: blobs[0]?.type ?? 'audio/webm' });

    let audioData: Float32Array;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const ctx = this.audioContext ?? new AudioContext({ sampleRate: this.config.sampleRate });
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      // Whisper expects mono 16kHz — resample if needed via AudioContext (already set to 16kHz)
      audioData = decoded.getChannelData(0);
    } catch (err) {
      logger.warn('[WasmSttEngine] Audio decode error:', err);
      return;
    }

    try {
      const result = await this.whisperPipeline(audioData, {
        sampling_rate: this.config.sampleRate,
      });
      const text = (Array.isArray(result) ? result[0]?.text : result.text)?.trim() ?? '';
      if (text) {
        this.onResultCallback?.({
          transcript: text,
          isFinal: true,
          confidence: 0.9,
          language: 'en',
        });
      }
    } catch (err) {
      logger.warn('[WasmSttEngine] Whisper inference error:', err);
      this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.transcribeTimer !== null) {
      clearInterval(this.transcribeTimer);
      this.transcribeTimer = null;
    }

    if (this.recorder?.state !== 'inactive') {
      this.recorder?.stop();
    }

    // Wait one tick for the final ondataavailable to fire, then drain
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    await this.drainAndTranscribe();

    this.cleanupAudio();
  }

  async dispose(): Promise<void> {
    this.isRunning = false;
    this.isDisposed = true;
    if (this.transcribeTimer !== null) {
      clearInterval(this.transcribeTimer);
      this.transcribeTimer = null;
    }
    if (this.recorder?.state !== 'inactive') {
      this.recorder?.stop();
    }
    this.cleanupAudio();
    this.onResultCallback = null;
    this.onErrorCallback = null;
    // QNBS-v3: Pipeline kept alive across sessions — 40 MB re-download is too expensive to repeat.
  }

  private cleanupAudio(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.recorder = null;
    this.pendingBlobs = [];
  }
}
