/**
 * Tests for the voice E2E test seam (services/voice/voiceTestSeam.ts) and its wiring into the
 * STT/VAD factories. QNBS-v3: P1-2 — the seam is production code, so it carries unit coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), withContext: vi.fn() }),
}));

import { createSttEngine } from '../../../services/voice/sttEngine';
import { createVadEngine } from '../../../services/voice/vadEngine';
import { getVoiceTestHarness } from '../../../services/voice/voiceTestSeam';
import type { SttEngine, VadEngine } from '../../../services/voice/voiceTypes';

type HarnessWindow = { __voiceTestHarness?: unknown };

function setHarness(value: unknown): void {
  (window as HarnessWindow).__voiceTestHarness = value;
}

describe('voiceTestSeam', () => {
  beforeEach(() => {
    delete (window as HarnessWindow).__voiceTestHarness;
  });
  afterEach(() => {
    delete (window as HarnessWindow).__voiceTestHarness;
  });

  it('returns undefined when no harness is installed', () => {
    expect(getVoiceTestHarness()).toBeUndefined();
  });

  it('returns the installed harness object', () => {
    const harness = { download: { mode: 'success' as const } };
    setHarness(harness);
    expect(getVoiceTestHarness()).toBe(harness);
  });

  it('createSttEngine returns the injected mock STT verbatim', async () => {
    const mockStt = {
      id: 'webSpeech',
      name: 'Mock',
      isLocal: true,
      supportsStreaming: false,
      isAvailable: () => Promise.resolve(true),
      initialize: () => Promise.resolve(),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
    } as unknown as SttEngine;
    setHarness({ stt: mockStt });
    const engine = await createSttEngine({ enableVoiceWasm: true });
    expect(engine).toBe(mockStt);
  });

  it('createVadEngine returns the injected mock VAD verbatim', async () => {
    const mockVad = {
      name: 'Mock VAD',
      isAvailable: () => Promise.resolve(true),
      initialize: () => Promise.resolve(),
      processChunk: () => Promise.resolve(null),
      dispose: () => Promise.resolve(),
    } as unknown as VadEngine;
    setHarness({ vad: mockVad });
    const engine = await createVadEngine(true);
    expect(engine).toBe(mockVad);
  });
});
