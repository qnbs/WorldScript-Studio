/**
 * Tests for services/ai/inferenceProgressEmitter.ts
 * QNBS-v3: Singleton pub/sub emitter — subscribe, snapshot, progress, ready, error, reset.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-import fresh singleton each time to isolate tests
describe('inferenceProgressEmitter', () => {
  let inferenceProgressEmitter: typeof import('../../../services/ai/inferenceProgressEmitter').inferenceProgressEmitter;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../services/ai/inferenceProgressEmitter');
    inferenceProgressEmitter = mod.inferenceProgressEmitter;
    // Reset to clean state
    inferenceProgressEmitter.reset();
  });

  it('starts in idle state', () => {
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.state).toBe('idle');
    expect(snapshot.progress).toBe(0);
    expect(snapshot.text).toBe('');
    expect(snapshot.estimatedSecondsRemaining).toBeNull();
  });

  it('delivers current snapshot to new subscriber immediately', () => {
    const listener = vi.fn();
    inferenceProgressEmitter.subscribeWebLlmLoading(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'idle' }));
  });

  it('reportWebLlmProgress changes state to loading', () => {
    inferenceProgressEmitter.reportWebLlmProgress(0.5, 'Downloading model');
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.state).toBe('loading');
    expect(snapshot.progress).toBe(0.5);
    expect(snapshot.text).toBe('Downloading model');
  });

  it('notifies subscribers on progress update', () => {
    const listener = vi.fn();
    const unsub = inferenceProgressEmitter.subscribeWebLlmLoading(listener);
    listener.mockClear();
    inferenceProgressEmitter.reportWebLlmProgress(0.3, 'Loading...');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'loading', progress: 0.3 }),
    );
    unsub();
  });

  it('reportWebLlmReady sets state to ready', () => {
    inferenceProgressEmitter.reportWebLlmProgress(0.9, 'Almost done');
    inferenceProgressEmitter.reportWebLlmReady();
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.state).toBe('ready');
    expect(snapshot.progress).toBe(1);
  });

  it('reportWebLlmError sets state to error', () => {
    inferenceProgressEmitter.reportWebLlmError('Model failed to load');
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.state).toBe('error');
    expect(snapshot.text).toBe('Model failed to load');
  });

  it('reset returns to idle state', () => {
    inferenceProgressEmitter.reportWebLlmProgress(0.5, 'Loading');
    inferenceProgressEmitter.reset();
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.state).toBe('idle');
    expect(snapshot.progress).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = inferenceProgressEmitter.subscribeWebLlmLoading(listener);
    listener.mockClear();
    unsub();
    inferenceProgressEmitter.reportWebLlmProgress(0.5, 'loading');
    expect(listener).not.toHaveBeenCalled();
  });

  it('estimatedSecondsRemaining is null for progress <= 0.01', () => {
    inferenceProgressEmitter.reportWebLlmProgress(0.005, 'starting');
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.estimatedSecondsRemaining).toBeNull();
  });

  it('estimatedSecondsRemaining is null when progress is 1', () => {
    inferenceProgressEmitter.reportWebLlmProgress(1, 'done');
    const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
    expect(snapshot.estimatedSecondsRemaining).toBeNull();
  });
});
