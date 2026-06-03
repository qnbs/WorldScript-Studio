// QNBS-v3: Phase 3 — tests for the Rust TaskSupervisor front-end (analyzeTextViaRust).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/tauriTaskBridge', () => ({
  isRustComputeAvailable: vi.fn(),
}));

vi.mock('../../services/hybridRouter', () => ({
  routeTask: vi.fn(),
}));

const ANALYSIS = {
  wordCount: 5,
  charCount: 26,
  charCountNoSpaces: 22,
  sentenceCount: 2,
  syllableCount: 7,
  fleschReadingEase: 90.1,
  readingTimeMinutes: 0.025,
};

describe('rustTaskSupervisor — analyzeTextViaRust', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null without probing when rustComputeEnabled is false', async () => {
    const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
    const { routeTask } = await import('../../services/hybridRouter');
    const { analyzeTextViaRust } = await import('../../services/rustTaskSupervisor');

    const result = await analyzeTextViaRust('hello', { rustComputeEnabled: false });

    expect(result).toBeNull();
    expect(isRustComputeAvailable).not.toHaveBeenCalled();
    expect(routeTask).not.toHaveBeenCalled();
  });

  it('returns null when Rust compute is unavailable', async () => {
    const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
    const { routeTask } = await import('../../services/hybridRouter');
    vi.mocked(isRustComputeAvailable).mockResolvedValue(false);
    const { analyzeTextViaRust } = await import('../../services/rustTaskSupervisor');

    const result = await analyzeTextViaRust('hello', { rustComputeEnabled: true });

    expect(result).toBeNull();
    expect(routeTask).not.toHaveBeenCalled();
  });

  it('routes to Rust and resolves the analysis payload', async () => {
    const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
    const { routeTask } = await import('../../services/hybridRouter');
    vi.mocked(isRustComputeAvailable).mockResolvedValue(true);
    vi.mocked(routeTask).mockResolvedValue({
      taskId: 't1',
      result: Promise.resolve(ANALYSIS),
      // biome-ignore lint/suspicious/noExplicitAny: test stub for TaskHandle progress/cancel
      progress: (async function* () {})() as any,
      cancel: vi.fn(),
    });
    const { analyzeTextViaRust } = await import('../../services/rustTaskSupervisor');

    const result = await analyzeTextViaRust('Hello world. This is fine.', {
      rustComputeEnabled: true,
    });

    expect(result).toEqual(ANALYSIS);
    expect(routeTask).toHaveBeenCalledWith(
      'text.analyze',
      { text: 'Hello world. This is fine.' },
      expect.objectContaining({ target: 'rust', rustComputeEnabled: true }),
    );
  });

  it('returns null when the router yields no handle (bus not ready)', async () => {
    const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
    const { routeTask } = await import('../../services/hybridRouter');
    vi.mocked(isRustComputeAvailable).mockResolvedValue(true);
    vi.mocked(routeTask).mockResolvedValue(null);
    const { analyzeTextViaRust } = await import('../../services/rustTaskSupervisor');

    expect(await analyzeTextViaRust('x', { rustComputeEnabled: true })).toBeNull();
  });

  it('swallows a rejected result and returns null for JS fallback', async () => {
    const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
    const { routeTask } = await import('../../services/hybridRouter');
    vi.mocked(isRustComputeAvailable).mockResolvedValue(true);
    vi.mocked(routeTask).mockResolvedValue({
      taskId: 't2',
      result: Promise.reject(new Error('rust boom')),
      // biome-ignore lint/suspicious/noExplicitAny: test stub for TaskHandle progress/cancel
      progress: (async function* () {})() as any,
      cancel: vi.fn(),
    });
    const { analyzeTextViaRust } = await import('../../services/rustTaskSupervisor');

    expect(await analyzeTextViaRust('x', { rustComputeEnabled: true })).toBeNull();
  });
});
