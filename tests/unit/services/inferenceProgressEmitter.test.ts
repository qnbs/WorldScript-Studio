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

  // QNBS-v3 (#333 item 1): derived byte metrics from a known-model-size lookup table.
  describe('derived byte metrics', () => {
    it('computes loadedBytes/totalBytes from a known model id', () => {
      inferenceProgressEmitter.reportWebLlmProgress(
        0.5,
        'Downloading',
        'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      );
      const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
      // 700 MB total (WEBLLM_MODEL_APPROX_MB) at 50% progress.
      expect(snapshot.totalBytes).toBe(700 * 1024 * 1024);
      expect(snapshot.loadedBytes).toBe(Math.round(700 * 1024 * 1024 * 0.5));
    });

    it('leaves byte fields null when no modelId is passed', () => {
      inferenceProgressEmitter.reportWebLlmProgress(0.5, 'Downloading');
      const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
      expect(snapshot.loadedBytes).toBeNull();
      expect(snapshot.totalBytes).toBeNull();
      expect(snapshot.bytesPerSecond).toBeNull();
    });

    it('leaves byte fields null for an unrecognized modelId', () => {
      inferenceProgressEmitter.reportWebLlmProgress(0.5, 'Downloading', 'not-a-real-model');
      const snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
      expect(snapshot.loadedBytes).toBeNull();
      expect(snapshot.totalBytes).toBeNull();
    });

    it('clears byte fields on ready/error/reset', () => {
      inferenceProgressEmitter.reportWebLlmProgress(
        0.5,
        'Downloading',
        'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      );
      inferenceProgressEmitter.reportWebLlmReady();
      let snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
      expect(snapshot.loadedBytes).toBeNull();
      expect(snapshot.totalBytes).toBeNull();

      inferenceProgressEmitter.reportWebLlmProgress(
        0.5,
        'Downloading',
        'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      );
      inferenceProgressEmitter.reportWebLlmError('failed');
      snapshot = inferenceProgressEmitter.getWebLlmLoadingSnapshot();
      expect(snapshot.loadedBytes).toBeNull();
      expect(snapshot.totalBytes).toBeNull();
    });
  });
});
