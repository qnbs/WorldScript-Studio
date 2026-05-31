/**
 * SileroVadEngine — Silero VAD v5 (ONNX) voice-activity detection.
 *
 * QNBS-v3: DEFERRED — intentionally not wired in this release.
 *
 * Silero VAD is NOT a transformers.js pipeline task, and `onnx-community/silero-vad`
 * ships only a raw `.onnx` file with no `config.json`, so it cannot be loaded through
 * `@huggingface/transformers` `AutoModel`. A production wiring needs either:
 *   - `onnxruntime-web` driving the v5 stateful graph directly
 *     (inputs: `input` f32[1,512], `state` f32[2,1,128], `sr` i64 → outputs `output`, `stateN`), or
 *   - the `@ricky0123/vad-web` library (bundles its own ORT + worklet assets).
 * Both require a real browser smoke test that cannot run in CI/headless, so neither was
 * landed blindly (avoids a plausible-but-broken inference path).
 *
 * Until that wiring lands, `isAvailable()` returns `false`, so `createVadEngine()` falls
 * back to the always-available energy-based {@link WebRtcVadEngine}. This keeps the
 * `enableVoiceWasm` path honest: better a working approximate VAD than a silent failure.
 *
 * Follow-up tracked in `docs/sprints/local-ai-perfection-*` and `TODO.md`
 * ("Silero VAD ONNX wiring"). Kokoro TTS and Whisper STT already use real transformers.js v3.
 */

import { logger } from '../logger';
import type { AudioChunk, VadEngine, VadSegment } from './voiceTypes';

export class SileroVadEngine implements VadEngine {
  readonly name = 'Silero VAD v5 (ONNX) — pending';

  async isAvailable(): Promise<boolean> {
    // QNBS-v3: deferred (see file header) — defer to WebRtcVadEngine until ONNX wiring lands.
    logger.info('[SileroVadEngine] ONNX v5 wiring pending — deferring to WebRTC VAD fallback');
    return false;
  }

  initialize(): Promise<void> {
    // QNBS-v3: unreachable while isAvailable() is false; throws loudly if force-instantiated.
    return Promise.reject(
      new Error(
        'SileroVadEngine is not wired yet (Silero v5 ONNX integration pending). ' +
          'isAvailable() returns false — use WebRtcVadEngine instead.',
      ),
    );
  }

  // QNBS-v3: contract stub — never invoked because the factory never selects a non-available engine.
  processChunk(_chunk: AudioChunk): Promise<VadSegment | null> {
    return Promise.resolve(null);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
