/**
 * WasmSttEngine — local Whisper STT via @huggingface/transformers (whisper-tiny.en, q8 dtype).
 * QNBS-v3: Phase 2 B-2 — eliminates cloud audio routing; gated behind enableVoiceWasm flag.
 * Audio capture: getUserMedia → one MediaRecorder per window → decodeAudioData → Float32Array → Whisper pipeline.
 */

import type { VoiceSttEngine } from '../../types';
import { logger } from '../logger';
import type { AudioStreamConfig, SttEngine, SttResult } from './voiceTypes';
import { DEFAULT_AUDIO_CONFIG } from './voiceTypes';

const MODEL_ID = 'Xenova/whisper-tiny.en';
/** Length of one recording window; every window is transcribed on its own. */
const TRANSCRIPTION_INTERVAL_MS = 3_500;
/** Upper bound for a recorder's final `stop` event, so stopping never hangs on a dead recorder. */
const RECORDER_STOP_TIMEOUT_MS = 1_000;
/** RMS level a 20 ms frame must exceed to count as voiced: the level the WebRTC VAD uses. */
const SPEECH_RMS = 0.01;
const FRAME_MS = 20;
/** Voiced time a window needs before Whisper sees it; Whisper writes "you" for a silent window. */
const MIN_SPEECH_MS = 200;

// @huggingface/transformers types (imported via alias in vite.config.ts + tsconfig paths)
type WhisperPipelineResult = { text?: string } | Array<{ text?: string }>;
type WhisperPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<WhisperPipelineResult>;

async function createWhisperPipeline(): Promise<WhisperPipeline> {
  // QNBS-v3: Keep the shared Transformers.js proxy lazy so voice setup does not load its model chunk early.
  const { pipeline, env } = await import('../../packages/ai-core/src/vendor-transformers');
  // Disable WASM proxy — run inline; proxy adds latency and SharedArrayBuffer dependency.
  interface XenovaEnv {
    backends?: { onnx?: { wasm?: { proxy?: boolean } } };
  }
  const typedEnv = env as unknown as XenovaEnv;
  if (typedEnv.backends?.onnx?.wasm) {
    typedEnv.backends.onnx.wasm.proxy = false;
  }
  // QNBS-v3: loose pipeline signature; the typed overload union is too large to represent (TS2590).
  const createPipeline = pipeline as (
    task: string,
    model: string,
    opts: unknown,
  ) => Promise<unknown>;
  return (await createPipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
  })) as WhisperPipeline;
}

/** Stops a recorder and resolves after its final `dataavailable`, which the spec fires before `stop`. */
function stopRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, RECORDER_STOP_TIMEOUT_MS);
    recorder.onstop = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      recorder.stop();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function joinSamples(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]!;
  const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function transcriptOf(result: WhisperPipelineResult): string {
  const first = Array.isArray(result) ? result[0] : result;
  return first?.text?.trim() ?? '';
}

function frameRms(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  for (let i = start; i < start + length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / length);
}

/** True once the window holds MIN_SPEECH_MS of voiced frames. */
function hasSpeech(samples: Float32Array, sampleRate: number): boolean {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const needed = Math.ceil(MIN_SPEECH_MS / FRAME_MS);
  let voiced = 0;
  for (let start = 0; start + frame <= samples.length; start += frame) {
    if (frameRms(samples, start, frame) > SPEECH_RMS) voiced += 1;
    if (voiced >= needed) return true;
  }
  return false;
}

export class WasmSttEngine implements SttEngine {
  readonly id: VoiceSttEngine = 'whisper';
  readonly name = 'Whisper Tiny (local WASM)';
  readonly isLocal = true;
  readonly supportsStreaming = false;

  private whisperPipeline: WhisperPipeline | null = null;
  private pipelineLoad: Promise<WhisperPipeline> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private pendingBlobs: Blob[] = [];
  private windowTimer: ReturnType<typeof setInterval> | null = null;
  private rotation: Promise<void> = Promise.resolve();
  private transcription: Promise<void> = Promise.resolve();
  /** Bumped by every start(), so a late chunk from an earlier session is never transcribed. */
  private session = 0;
  /** Bumped by start(), stop() and dispose(): a start() overtaken by a stop never opens the mic. */
  private startAttempt = 0;
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
    await this.loadPipeline();
  }

  // QNBS-v3 (#556): one shared, retryable load for dictation (no initialize()) and the VAD coordinator.
  private loadPipeline(): Promise<WhisperPipeline> {
    if (this.whisperPipeline) return Promise.resolve(this.whisperPipeline);
    this.pipelineLoad ??= createWhisperPipeline().then(
      (loaded) => {
        this.whisperPipeline = loaded;
        logger.info('[WasmSttEngine] Whisper pipeline ready');
        return loaded;
      },
      (err: unknown) => {
        this.pipelineLoad = null;
        throw err;
      },
    );
    return this.pipelineLoad;
  }

  async start(
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    const attempt = ++this.startAttempt;
    // QNBS-v3 (#556): dictation never calls initialize(); load here, so a failed load rejects before the mic opens.
    await this.loadPipeline();
    if (attempt !== this.startAttempt) return; // stopped or disposed while the model loaded

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Microphone access denied: ${msg}`);
    }
    if (attempt !== this.startAttempt) {
      // Stopped while the browser granted the microphone: release it instead of recording.
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    this.session += 1;
    const session = this.session;
    this.onResultCallback = onResult;
    this.onErrorCallback = onError;
    this.pendingBlobs = [];
    this.isRunning = true;
    this.isDisposed = false;
    this.mediaStream = stream;
    this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });
    this.recorder = this.startWindow(stream, session);
    this.windowTimer = setInterval(() => {
      this.rotation = this.rotateWindow(session);
    }, TRANSCRIPTION_INTERVAL_MS);
  }

  // QNBS-v3 (#556): one recording per window; a timesliced recorder puts the WebM header in its first chunk only.
  private startWindow(stream: MediaStream, session: number): MediaRecorder {
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    // The final chunk arrives after stop() has cleared isRunning, so only the session decides.
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0 && this.ownsChunk(session)) this.pendingBlobs.push(event.data);
    };
    recorder.start();
    return recorder;
  }

  private ownsChunk(session: number): boolean {
    return session === this.session && !this.isDisposed;
  }

  /** The microphone stream while this session is still recording, otherwise null. */
  private liveStream(session: number): MediaStream | null {
    return this.isRunning && session === this.session ? this.mediaStream : null;
  }

  private async rotateWindow(session: number): Promise<void> {
    const finished = this.recorder;
    const stream = this.liveStream(session);
    if (!finished || !stream) return;
    // Start the next window before stopping this one, so no audio falls between them.
    this.recorder = this.startWindow(stream, session);
    await stopRecorder(finished);
    await this.queueTranscription();
  }

  /** Transcriptions run one after another, so results arrive in recording order. */
  private queueTranscription(): Promise<void> {
    this.transcription = this.transcription.then(() => this.drainAndTranscribe());
    return this.transcription;
  }

  // QNBS-v3: Check isDisposed (not isRunning) — stop() sets isRunning=false but still drains remaining blobs.
  private hasPendingAudio(): boolean {
    return !this.isDisposed && this.pendingBlobs.length > 0;
  }

  private async drainAndTranscribe(): Promise<void> {
    const transcribe = this.whisperPipeline;
    if (!transcribe || !this.hasPendingAudio()) return;

    const audioData = await this.decodeWindows(this.pendingBlobs.splice(0));
    // QNBS-v3 (#556): a window without speech never reaches Whisper, which writes "you" for silence.
    if (!hasSpeech(audioData, this.config.sampleRate)) return;

    try {
      const text = transcriptOf(
        await transcribe(audioData, { sampling_rate: this.config.sampleRate }),
      );
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

  /** Each blob is one complete recording: decode them one by one and join the samples. */
  private async decodeWindows(blobs: Blob[]): Promise<Float32Array> {
    const ctx = this.audioContext;
    if (!ctx) return new Float32Array(0);
    const parts: Float32Array[] = [];
    for (const blob of blobs) {
      try {
        // Whisper expects mono 16 kHz; decodeAudioData resamples to the context rate (16 kHz).
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        parts.push(decoded.getChannelData(0));
      } catch (err) {
        logger.warn('[WasmSttEngine] Audio decode error:', err);
      }
    }
    return parts.length === 0 ? new Float32Array(0) : joinSamples(parts);
  }

  async stop(): Promise<void> {
    this.startAttempt += 1;
    this.isRunning = false;
    this.clearWindowTimer();
    await this.rotation;
    const recorder = this.recorder;
    this.recorder = null;
    // QNBS-v3 (#556): keep the last, partial window; an utterance shorter than one window was lost here.
    if (recorder) await stopRecorder(recorder);
    await this.queueTranscription();
    this.cleanupAudio();
  }

  async dispose(): Promise<void> {
    this.startAttempt += 1;
    this.isRunning = false;
    this.isDisposed = true;
    this.clearWindowTimer();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopped; nothing left to drain after dispose.
      }
    }
    this.cleanupAudio();
    this.onResultCallback = null;
    this.onErrorCallback = null;
    // QNBS-v3: Pipeline kept alive across sessions — 40 MB re-download is too expensive to repeat.
  }

  private clearWindowTimer(): void {
    if (this.windowTimer !== null) {
      clearInterval(this.windowTimer);
      this.windowTimer = null;
    }
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
