import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiUsageTracker } from '../../services/ai/aiUsageTracker';

afterEach(() => {
  aiUsageTracker.reset();
  vi.restoreAllMocks();
});

describe('aiUsageTracker', () => {
  it('records and exposes the latest usage', () => {
    aiUsageTracker.record({ promptTokens: 100, completionTokens: 40, totalTokens: 140 }, 1_000);
    expect(aiUsageTracker.getLast()).toEqual({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      at: 1_000,
    });
  });

  it('derives totalTokens and normalises input/output field names', () => {
    aiUsageTracker.record({ inputTokens: 30, outputTokens: 20 }, 2_000);
    expect(aiUsageTracker.getLast()).toEqual({
      promptTokens: 30,
      completionTokens: 20,
      totalTokens: 50,
      at: 2_000,
    });
  });

  it('ignores empty/zero usage so a meaningful prior reading is not cleared', () => {
    aiUsageTracker.record({ totalTokens: 140 }, 1_000);
    aiUsageTracker.record({ totalTokens: 0 }, 3_000);
    expect(aiUsageTracker.getLast()?.totalTokens).toBe(140);
  });

  it('notifies subscribers on record and stops after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = aiUsageTracker.subscribe(cb);
    aiUsageTracker.record({ totalTokens: 10 }, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    aiUsageTracker.record({ totalTokens: 20 }, 2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('reset clears the snapshot and notifies', () => {
    const cb = vi.fn();
    aiUsageTracker.subscribe(cb);
    aiUsageTracker.record({ totalTokens: 10 }, 1);
    aiUsageTracker.reset();
    expect(aiUsageTracker.getLast()).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
