/**
 * SileroVadEngine — Silero VAD v4 ONNX model for precise voice activity detection.
 * QNBS-v3: Phase 2 B-2 scaffold. Full wiring deferred to Phase 3 because VadEngine.processChunk()
 * is synchronous but ONNX inference is async — interface refactor required first.
 * When activated: loads `Xenova/silero_vad` from HuggingFace Hub via @xenova/transformers.
 * Until then: factory falls back to WebRtcVadEngine (energy-threshold).
 */

import type { AudioChunk, VadEngine, VadSegment } from './voiceTypes';

export class SileroVadEngine implements VadEngine {
  readonly name = 'Silero VAD v4 (ONNX)';

  isAvailable(): Promise<boolean> {
    // QNBS-v3: Returns false until Phase 3 adds async processChunk() to VadEngine interface.
    // Model: Xenova/silero_vad (HuggingFace) via @xenova/transformers; ~2 MB ONNX.
    // LSTM inputs: h[2,1,64] + c[2,1,64] per 512-sample window at 16kHz.
    return Promise.resolve(false);
  }

  async initialize(): Promise<void> {
    throw new Error(
      'SileroVadEngine.initialize() not yet active — use WebRtcVadEngine instead (Phase 3 will activate this)',
    );
  }

  processChunk(_chunk: AudioChunk): VadSegment | null {
    return null;
  }

  async dispose(): Promise<void> {
    // Nothing to dispose in scaffold state
  }
}
