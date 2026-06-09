/**
 * VoiceActivityCoordinator — bridges WebRtcVadEngine PCM frames to WasmSttEngine.
 * QNBS-v3: B-2 completion — wires VAD-gated Whisper inference without touching the
 * Web Speech API path. Only activated when enableVoiceWasm + sttEngine.id === 'whisper'.
 */

import { createLogger } from '../logger';
import type { AudioChunk, SttEngine, SttResult, VadEngine } from './voiceTypes';
import { DEFAULT_AUDIO_CONFIG } from './voiceTypes';

const log = createLogger('VoiceActivityCoordinator');

// QNBS-v3: WebRtcVadEngine emits exactly one isSpeech event per speech-start transition
// (not continuous while speaking), so MIN_SPEECH_CHUNKS=2 would never be reached. Use 1.
const MIN_SPEECH_CHUNKS = 1;
/** Max buffered duration in ms before forcing an STT flush to avoid unbounded memory use. */
const MAX_BUFFER_MS = 15_000;

export class VoiceActivityCoordinator {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private speechChunkCount = 0;
  private bufferedDurationMs = 0;
  private isSttActive = false;
  private running = false;
  // QNBS-v3: tracks last known VAD state so null frames ("no change") don't reset speech
  private lastVadSpeechState = false;
  // QNBS-v3: guard prevents overlapping flush cycles (stop + restart) on Whisper WASM
  private isFlushing = false;
  // QNBS-v3: engines are initialized once per coordinator lifetime, not per start() call
  private isEngineInitialized = false;

  constructor(
    private readonly vad: VadEngine,
    private readonly stt: SttEngine,
  ) {}

  async start(
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    // QNBS-v3: guard prevents double-start which would open a second mic stream without closing the first
    if (this.running) return;
    this.running = true;
    try {
      // Initialize engines once — WasmSttEngine keeps the 40 MB Whisper pipeline
      // alive across sessions; re-calling initialize() would cause memory churn.
      if (!this.isEngineInitialized) {
        await this.vad.initialize();
        await this.stt.initialize();
        this.isEngineInitialized = true;
      }
      this.mediaStream = await this.setupAudioCapture();
      this.startFramePump(onResult, onError);
    } catch (err) {
      this.running = false;
      onError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.teardownAudioCapture();
    if (this.isSttActive) {
      try {
        await this.stt.stop();
      } catch (err) {
        log.warn('stt.stop() failed on coordinator stop', { err });
      }
      this.isSttActive = false;
    }
    this.resetBufferState();
    this.lastVadSpeechState = false;
    this.isFlushing = false;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.isEngineInitialized = false;
    try {
      await this.vad.dispose();
    } catch (err) {
      log.warn('vad.dispose() failed', { err });
    }
    try {
      await this.stt.dispose();
    } catch (err) {
      log.warn('stt.dispose() failed', { err });
    }
  }

  private async setupAudioCapture(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: DEFAULT_AUDIO_CONFIG.sampleRate,
        channelCount: DEFAULT_AUDIO_CONFIG.channelCount,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return stream;
  }

  private startFramePump(
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): void {
    if (!this.mediaStream) return;

    this.audioContext = new AudioContext({ sampleRate: DEFAULT_AUDIO_CONFIG.sampleRate });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    // QNBS-v3: ScriptProcessorNode is deprecated but universally supported; AudioWorklet
    // requires a separate file registration step not yet available in this build.
    this.scriptProcessor = this.audioContext.createScriptProcessor(
      DEFAULT_AUDIO_CONFIG.bufferSize,
      1,
      1,
    );

    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.running) return;
      const inputData = event.inputBuffer.getChannelData(0);
      // Convert Float32 → Int16 PCM for VAD
      const pcm = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, inputData[i]! * 32768));
      }
      const durationMs = (inputData.length / DEFAULT_AUDIO_CONFIG.sampleRate) * 1000;
      const chunk: AudioChunk = {
        buffer: pcm,
        durationMs,
        hasSpeech: false,
        capturedAt: Date.now(),
      };
      this.processAudioFrame(chunk, onResult, onError);
    };

    this.source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  private processAudioFrame(
    chunk: AudioChunk,
    onResult: (result: SttResult) => void,
    onError: (error: Error) => void,
  ): void {
    this.vad
      .processChunk(chunk)
      .then((segment) => {
        if (!this.running) return;

        // QNBS-v3: WebRtcVadEngine returns null for "no state change" frames (most audio).
        // Treating null as silence was causing speechChunkCount to reset on every steady-state
        // speech frame, preventing MIN_SPEECH_CHUNKS from ever being reached. Preserve the
        // last known speech state instead of coercing null to false.
        if (segment === null) {
          // No VAD state change — accumulate buffer duration if already in speech
          if (this.lastVadSpeechState) {
            this.bufferedDurationMs += chunk.durationMs;
            if (this.isSttActive && this.bufferedDurationMs >= MAX_BUFFER_MS) {
              this.flushStt(onResult, onError);
            }
          }
          return;
        }

        const hasSpeech = segment.isSpeech;
        this.lastVadSpeechState = hasSpeech;

        if (hasSpeech) {
          this.speechChunkCount++;
          this.bufferedDurationMs += chunk.durationMs;

          // Activate STT after MIN_SPEECH_CHUNKS of confirmed speech-start events
          if (!this.isSttActive && this.speechChunkCount >= MIN_SPEECH_CHUNKS) {
            this.isSttActive = true;
            this.stt.start(onResult, onError).catch((err) => {
              log.error(
                'stt.start() failed in coordinator',
                err instanceof Error ? err : new Error(String(err)),
              );
              onError(err instanceof Error ? err : new Error(String(err)));
            });
          }

          // Flush if buffer exceeds max duration to prevent unbounded growth
          if (this.isSttActive && this.bufferedDurationMs >= MAX_BUFFER_MS) {
            this.flushStt(onResult, onError);
          }
        } else {
          // Confirmed silence edge from VAD — stop STT if active
          if (this.isSttActive) {
            this.flushStt(onResult, onError);
          }
          this.speechChunkCount = 0;
        }
      })
      .catch((err) => {
        log.warn('VAD processChunk error', { err });
      });
  }

  private flushStt(onResult: (result: SttResult) => void, onError: (error: Error) => void): void {
    // QNBS-v3: Guard against overlapping flush cycles. WasmSttEngine.stop() is async
    // (150 ms drain + cleanupAudio); starting STT before stop() resolves races over
    // shared mediaStream/recorder/audioContext fields and can corrupt the capture session.
    if (this.isFlushing) return;
    this.isFlushing = true;
    this.isSttActive = false;
    this.resetBufferState();

    this.stt
      .stop()
      .catch((err) => {
        log.warn('stt.stop() failed during flush', { err });
      })
      .then(() => {
        this.isFlushing = false;
        if (!this.running) return;
        // Restart STT for the next utterance only after stop() has fully resolved
        return this.stt.start(onResult, onError).then(() => {
          this.isSttActive = true;
        });
      })
      .catch((err) => {
        this.isFlushing = false;
        log.error(
          'stt.start() failed after flush',
          err instanceof Error ? err : new Error(String(err)),
        );
        onError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  private resetBufferState(): void {
    this.speechChunkCount = 0;
    this.bufferedDurationMs = 0;
  }

  private teardownAudioCapture(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
  }
}
