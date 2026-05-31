/**
 * VAD (Voice Activity Detection) implementations.
 * QNBS-v3: WebRTC VAD as immediate fallback; Silero VAD v4 via ONNX in future phase.
 */

import { logger } from '../logger';
import type { AudioChunk, VadEngine, VadSegment } from './voiceTypes';

// ── WebRTC VAD Fallback ──────────────────────────────────────────────────────

/**
 * Simple energy-based VAD that approximates WebRTC behavior.
 * QNBS-v3: This is a pragmatic fallback until Silero ONNX is integrated.
 */
export class WebRtcVadEngine implements VadEngine {
  readonly name = 'WebRTC VAD (energy-based)';

  private energyThreshold = 0.01;
  private minSpeechFrames = 3;
  private minSilenceFrames = 5;
  private speechFrames = 0;
  private silenceFrames = 0;
  private isSpeechActive = false;

  isAvailable(): Promise<boolean> {
    // Always available — pure JS implementation
    return Promise.resolve(true);
  }

  async initialize(): Promise<void> {
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.isSpeechActive = false;
  }

  async processChunk(chunk: AudioChunk): Promise<VadSegment | null> {
    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < chunk.buffer.length; i++) {
      const sample = chunk.buffer[i]!;
      const normalized = sample / 32768.0;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / chunk.buffer.length);
    const isSpeech = rms > this.energyThreshold;

    if (isSpeech) {
      this.speechFrames++;
      this.silenceFrames = 0;
      if (!this.isSpeechActive && this.speechFrames >= this.minSpeechFrames) {
        this.isSpeechActive = true;
        return {
          startMs: chunk.capturedAt,
          endMs: chunk.capturedAt + chunk.durationMs,
          isSpeech: true,
        };
      }
    } else {
      this.silenceFrames++;
      this.speechFrames = 0;
      if (this.isSpeechActive && this.silenceFrames >= this.minSilenceFrames) {
        this.isSpeechActive = false;
        return {
          startMs: chunk.capturedAt,
          endMs: chunk.capturedAt + chunk.durationMs,
          isSpeech: false,
        };
      }
    }

    return null;
  }

  async dispose(): Promise<void> {
    this.isSpeechActive = false;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createVadEngine(enableVoiceWasm = false): Promise<VadEngine> {
  // QNBS-v3: Phase 2 — try Silero VAD when enableVoiceWasm is on; falls back to energy-based.
  if (enableVoiceWasm) {
    try {
      const { SileroVadEngine } = await import('./sileroVadEngine');
      const silero = new SileroVadEngine();
      if (await silero.isAvailable()) {
        logger.info(`VAD engine selected: ${silero.name}`);
        return silero;
      }
    } catch (err) {
      logger.warn('[createVadEngine] SileroVadEngine unavailable, falling back:', err);
    }
  }

  const engine = new WebRtcVadEngine();
  if (await engine.isAvailable()) {
    logger.info(`VAD engine selected: ${engine.name}`);
    return engine;
  }
  throw new Error('No VAD engine available');
}
