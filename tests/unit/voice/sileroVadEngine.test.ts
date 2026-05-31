// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// QNBS-v3: avoid logger side-effects (IDB/console) in the unit env.
vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SileroVadEngine } from '../../../services/voice/sileroVadEngine';
import type { AudioChunk } from '../../../services/voice/voiceTypes';

/**
 * QNBS-v3: Silero VAD is intentionally DEFERRED (see sileroVadEngine.ts header). These tests pin the
 * honest-fallback contract: isAvailable() must report false so createVadEngine() selects the
 * energy-based WebRtcVadEngine instead, and the engine must never silently pretend to work.
 */
describe('SileroVadEngine (deferred → WebRTC VAD fallback)', () => {
  it('isAvailable() returns false so the factory falls back to WebRtcVadEngine', async () => {
    expect(await new SileroVadEngine().isAvailable()).toBe(false);
  });

  it('initialize() rejects loudly — the ONNX path is not wired yet', async () => {
    await expect(new SileroVadEngine().initialize()).rejects.toThrow(/not wired yet/i);
  });

  it('processChunk() resolves to null (contract stub, never reached via the factory)', async () => {
    const chunk: AudioChunk = {
      buffer: new Int16Array(512),
      durationMs: 32,
      hasSpeech: false,
      capturedAt: 0,
    };
    expect(await new SileroVadEngine().processChunk(chunk)).toBeNull();
  });

  it('dispose() resolves without error', async () => {
    await expect(new SileroVadEngine().dispose()).resolves.toBeUndefined();
  });

  it('exposes a descriptive, pending-flagged name', () => {
    expect(new SileroVadEngine().name).toMatch(/silero/i);
  });
});
