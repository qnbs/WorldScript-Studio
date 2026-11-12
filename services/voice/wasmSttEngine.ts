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
/** Windows waiting for Whisper at most (~14 s of audio); beyond that a window is skipped and reported. */
const MAX_QUEUED_WINDOWS = 4;
const BACKLOG_MESSAGE =
  'Local speech recognition is falling behind; a 3.5-second stretch of audio was skipped.';

// @huggingface/transformers types (imported via alias in vite.config.ts + tsconfig paths)
type WhisperPipelineResult = { text?: string } | Array<{ text?: string }>;
type WhisperPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<WhisperPipelineResult>;

/** One recording: a timesliced recorder writes the WebM header into its first chunk only, so each window is its own. */
interface RecordingWindow {
  readonly recorder: MediaRecorder;
  readonly chunks: Blob[];
}

/** Everything one start() acquires; stop() and dispose() release exactly the session they took. */
interface CaptureSession {
  readonly stream: MediaStream;
  readonly audioContext: AudioContext;
  readonly onResult: (result: SttResult) => void;
  readonly onError: (error: Error) => void;
  /** The engine's dispose count when the session started; a later dispose silences its results. */
  readonly disposals: number;
  window: RecordingWindow | null;
  timer: ReturnType<typeof setInterval> | null;
  /** The latest window rotation; stop() waits for it so the windows stay in recording order. */
  rotation: Promise<void>;
}

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

// QNBS-v3 (#556): record the first container the browser supports; with none of these, its own default (Safari records MP4).
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function recorderOptions(): MediaRecorderOptions | undefined {
  const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function startWindow(stream: MediaStream): RecordingWindow {
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, recorderOptions());
  // The final chunk arrives after stop(); it belongs to this window whatever the engine does meanwhile.
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  return { recorder, chunks };
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

function releaseTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Decodes one window's recording; decodeAudioData resamples it to the 16 kHz the context runs at. */
async function decodeWindow(ctx: AudioContext, chunks: Blob[]): Promise<Float32Array> {
  const recording = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
  const decoded = await ctx.decodeAudioData(await recording.arrayBuffer());
  return decoded.getChannelData(0);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Runs a consumer callback; a throwing consumer must not break the transcription queue. */
function deliver(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    logger.warn('[WasmSttEngine] A result callback threw:', error);
  }
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
  private session: CaptureSession | null = null;
  private transcription: Promise<void> = Promise.resolve();
  private queuedWindows = 0;
  /** Bumped by start(), stop() and dispose(): a start() overtaken by a stop never opens the mic. */
  private startAttempt = 0;
  private disposals = 0;
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
    // QNBS-v3 (#556): one session at a time; a second start would leave the first microphone stream open.
    if (this.session) return;
    const attempt = ++this.startAttempt;
    // QNBS-v3 (#556): dictation never calls initialize(); load here, so a failed load rejects before the mic opens.
    await this.loadPipeline();
    if (attempt !== this.startAttempt) return; // stopped or disposed while the model loaded

    const stream = await this.openMicrophone();
    if (attempt !== this.startAttempt) {
      // Stopped while the browser granted the microphone: release it instead of recording.
      releaseTracks(stream);
      return;
    }

    try {
      this.session = this.openSession(stream, onResult, onError);
    } catch (error) {
      // QNBS-v3 (#556): a session that cannot be built must not leave the granted microphone running.
      releaseTracks(stream);
      throw error;
    }
  }

  private async openMicrophone(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
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
  }

  private openSession(
    stream: MediaStream,
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): CaptureSession {
    const audioContext = new AudioContext({ sampleRate: this.config.sampleRate });
    try {
      const session: CaptureSession = {
        stream,
        audioContext,
        onResult,
        onError,
        disposals: this.disposals,
        window: startWindow(stream),
        timer: null,
        rotation: Promise.resolve(),
      };
      session.timer = setInterval(() => {
        session.rotation = this.rotateWindow(session);
      }, TRANSCRIPTION_INTERVAL_MS);
      return session;
    } catch (error) {
      void audioContext.close();
      throw error;
    }
  }

  private async rotateWindow(session: CaptureSession): Promise<void> {
    const finished = session.window;
    if (!finished || this.session !== session) return;
    let next: RecordingWindow;
    try {
      // Start the next window before stopping this one, so no audio falls between them.
      next = startWindow(session.stream);
    } catch (error) {
      // QNBS-v3 (#556): the next window cannot be recorded; end the session, keep what was recorded, and say why.
      this.session = null;
      clearSessionTimer(session);
      session.window = null;
      await this.closeSession(session, finished, Promise.resolve());
      if (this.isLive(session)) deliver(() => session.onError(toError(error)));
      return;
    }
    session.window = next;
    await stopRecorder(finished.recorder);
    await this.queueTranscription(session, finished.chunks);
  }

  /** Each window is its own job and transcriptions run one after another, so results arrive in recording order. */
  private queueTranscription(session: CaptureSession, chunks: Blob[]): Promise<void> {
    if (this.queuedWindows >= MAX_QUEUED_WINDOWS) {
      // QNBS-v3 (#556): a bounded backlog; a skipped window is reported instead of letting the queue and the stop latency grow.
      if (this.isLive(session)) deliver(() => session.onError(new Error(BACKLOG_MESSAGE)));
      return this.transcription;
    }
    this.queuedWindows += 1;
    this.transcription = this.transcription
      .then(() => this.transcribeWindow(session, chunks))
      .catch((error: unknown) => logger.warn('[WasmSttEngine] Transcription failed:', error))
      .finally(() => {
        this.queuedWindows -= 1;
      });
    return this.transcription;
  }

  private isLive(session: CaptureSession): boolean {
    return session.disposals === this.disposals;
  }

  private hasWork(session: CaptureSession, chunks: Blob[]): boolean {
    return chunks.length > 0 && this.isLive(session);
  }

  private async transcribeWindow(session: CaptureSession, chunks: Blob[]): Promise<void> {
    const transcribe = this.whisperPipeline;
    if (!transcribe || !this.hasWork(session, chunks)) return;
    let audioData: Float32Array;
    try {
      audioData = await decodeWindow(session.audioContext, chunks);
    } catch (error) {
      // QNBS-v3 (#556): a window that cannot be decoded is reported, not dropped without a word.
      logger.warn('[WasmSttEngine] Audio decode error:', error);
      if (this.isLive(session)) deliver(() => session.onError(toError(error)));
      return;
    }
    // QNBS-v3 (#556): a window without speech never reaches Whisper, which writes "you" for silence.
    if (hasSpeech(audioData, this.config.sampleRate))
      await this.infer(session, transcribe, audioData);
  }

  private async infer(
    session: CaptureSession,
    transcribe: WhisperPipeline,
    audioData: Float32Array,
  ): Promise<void> {
    let text: string;
    try {
      text = transcriptOf(await transcribe(audioData, { sampling_rate: this.config.sampleRate }));
    } catch (err) {
      logger.warn('[WasmSttEngine] Whisper inference error:', err);
      if (this.isLive(session)) deliver(() => session.onError(toError(err)));
      return;
    }
    if (text && this.isLive(session)) {
      deliver(() =>
        session.onResult({ transcript: text, isFinal: true, confidence: 0.9, language: 'en' }),
      );
    }
  }

  async stop(): Promise<void> {
    this.startAttempt += 1;
    const session = this.session;
    this.session = null;
    if (!session) return;
    clearSessionTimer(session);
    const last = session.window;
    session.window = null;
    await this.closeSession(session, last, session.rotation);
  }

  /** Ends capture first, then transcribes the last window and closes the audio context, whatever fails. */
  private async closeSession(
    session: CaptureSession,
    last: RecordingWindow | null,
    rotation: Promise<void>,
  ): Promise<void> {
    try {
      // QNBS-v3 (#556): capture ends before any inference wait; the last, partial window is still transcribed.
      if (last) await stopRecorder(last.recorder);
      releaseTracks(session.stream);
      await rotation;
      await (last ? this.queueTranscription(session, last.chunks) : this.transcription);
    } finally {
      void session.audioContext.close();
    }
  }

  async dispose(): Promise<void> {
    this.startAttempt += 1;
    this.disposals += 1;
    const session = this.session;
    this.session = null;
    if (!session) return;
    clearSessionTimer(session);
    const recorder = session.window?.recorder;
    session.window = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopped; nothing is transcribed after dispose.
      }
    }
    releaseTracks(session.stream);
    void session.audioContext.close();
    // QNBS-v3: Pipeline kept alive across sessions — 40 MB re-download is too expensive to repeat.
  }
}

function clearSessionTimer(session: CaptureSession): void {
  if (session.timer !== null) {
    clearInterval(session.timer);
    session.timer = null;
  }
}
