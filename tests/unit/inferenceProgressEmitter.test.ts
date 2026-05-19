import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('inferenceProgressEmitter', () => {
  // QNBS-v3: Reset module between tests so singleton state is clean.
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh() {
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    return inferenceProgressEmitter;
  }

  it('initial snapshot is idle with zero progress', async () => {
    const emitter = await fresh();
    const snap = emitter.getWebLlmLoadingSnapshot();
    expect(snap.state).toBe('idle');
    expect(snap.progress).toBe(0);
    expect(snap.estimatedSecondsRemaining).toBeNull();
  });

  it('subscriber receives current snapshot immediately on subscribe', async () => {
    const emitter = await fresh();
    emitter.reportWebLlmProgress(0.5, 'Loading…');
    const received: unknown[] = [];
    emitter.subscribeWebLlmLoading((s) => received.push(s));
    expect(received).toHaveLength(1);
    expect((received[0] as { progress: number }).progress).toBe(0.5);
  });

  it('reportWebLlmProgress emits loading state with correct progress', async () => {
    const emitter = await fresh();
    const snapshots: unknown[] = [];
    emitter.subscribeWebLlmLoading((s) => snapshots.push(s));
    snapshots.length = 0; // clear initial snapshot
    emitter.reportWebLlmProgress(0.42, 'Downloading weights…');
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0] as { state: string }).state).toBe('loading');
    expect((snapshots[0] as { progress: number }).progress).toBe(0.42);
    expect((snapshots[0] as { text: string }).text).toBe('Downloading weights…');
  });

  it('reportWebLlmReady sets state to ready and progress to 1', async () => {
    const emitter = await fresh();
    emitter.reportWebLlmProgress(0.8, 'Almost…');
    emitter.reportWebLlmReady();
    const snap = emitter.getWebLlmLoadingSnapshot();
    expect(snap.state).toBe('ready');
    expect(snap.progress).toBe(1);
    expect(snap.estimatedSecondsRemaining).toBeNull();
  });

  it('reportWebLlmError sets state to error with message', async () => {
    const emitter = await fresh();
    emitter.reportWebLlmProgress(0.3, 'Loading…');
    emitter.reportWebLlmError('Network timeout');
    const snap = emitter.getWebLlmLoadingSnapshot();
    expect(snap.state).toBe('error');
    expect(snap.text).toBe('Network timeout');
  });

  it('unsubscribe prevents further notifications', async () => {
    const emitter = await fresh();
    const calls: number[] = [];
    const unsub = emitter.subscribeWebLlmLoading(() => calls.push(1));
    calls.length = 0;
    unsub();
    emitter.reportWebLlmProgress(0.5, 'x');
    expect(calls).toHaveLength(0);
  });

  it('reset returns emitter to idle state', async () => {
    const emitter = await fresh();
    emitter.reportWebLlmProgress(0.7, 'Loading…');
    emitter.reset();
    const snap = emitter.getWebLlmLoadingSnapshot();
    expect(snap.state).toBe('idle');
    expect(snap.progress).toBe(0);
  });

  it('estimates seconds remaining after some time has passed', async () => {
    const emitter = await fresh();
    // Start timer by first progress call
    emitter.reportWebLlmProgress(0.01, 'Start'); // sets loadStartMs
    vi.advanceTimersByTime(10_000); // advance 10s
    emitter.reportWebLlmProgress(0.5, 'Halfway'); // 50% done in 10s → ~10s remaining
    const snap = emitter.getWebLlmLoadingSnapshot();
    // Estimate should be ~10s (±2s tolerance)
    expect(snap.estimatedSecondsRemaining).toBeGreaterThan(5);
    expect(snap.estimatedSecondsRemaining).toBeLessThan(20);
  });
});
