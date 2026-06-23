import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiUsageTracker } from '../../services/ai/aiUsageTracker';

afterEach(() => {
  aiUsageTracker.reset();
  vi.restoreAllMocks();
});

describe('aiUsageTracker', () => {
  it('records and exposes the latest usage for a source', () => {
    aiUsageTracker.record(
      { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      'writer',
      1_000,
    );
    expect(aiUsageTracker.getLast('writer')).toEqual({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      at: 1_000,
      source: 'writer',
    });
  });

  it('derives totalTokens and normalises input/output field names', () => {
    aiUsageTracker.record({ inputTokens: 30, outputTokens: 20 }, 'writer', 2_000);
    const snap = aiUsageTracker.getLast('writer');
    expect(snap?.promptTokens).toBe(30);
    expect(snap?.completionTokens).toBe(20);
    expect(snap?.totalTokens).toBe(50);
  });

  it('treats zero legacy fields as missing and falls through to modern fields', () => {
    aiUsageTracker.record(
      { promptTokens: 0, completionTokens: 0, inputTokens: 5, outputTokens: 7 },
      'writer',
      1_000,
    );
    const snap = aiUsageTracker.getLast('writer');
    expect(snap?.promptTokens).toBe(5);
    expect(snap?.completionTokens).toBe(7);
    expect(snap?.totalTokens).toBe(12);
  });

  it('derives a total when totalTokens is zero but prompt/completion are not', () => {
    aiUsageTracker.record(
      { totalTokens: 0, promptTokens: 10, completionTokens: 5 },
      'writer',
      1_000,
    );
    expect(aiUsageTracker.getLast('writer')?.totalTokens).toBe(15);
  });

  it('ignores truly-empty usage so a meaningful prior reading is not cleared', () => {
    aiUsageTracker.record({ totalTokens: 140 }, 'writer', 1_000);
    aiUsageTracker.record({ totalTokens: 0 }, 'writer', 3_000);
    expect(aiUsageTracker.getLast('writer')?.totalTokens).toBe(140);
  });

  it('scopes usage by source — one surface never overwrites another', () => {
    aiUsageTracker.record({ totalTokens: 100 }, 'writer', 1_000);
    aiUsageTracker.record({ totalTokens: 999 }, 'copilot', 2_000);
    expect(aiUsageTracker.getLast('writer')?.totalTokens).toBe(100);
    expect(aiUsageTracker.getLast('copilot')?.totalTokens).toBe(999);
    // No source → the most recent across surfaces.
    expect(aiUsageTracker.getLast()?.source).toBe('copilot');
  });

  it('getLast() picks the globally newest even when a later-iterated entry is older', () => {
    // Insertion order a→b, but a is newer — exercises the `snap.at > latest.at` false branch.
    aiUsageTracker.record({ totalTokens: 10 }, 'a', 3_000);
    aiUsageTracker.record({ totalTokens: 20 }, 'b', 1_000);
    expect(aiUsageTracker.getLast()?.source).toBe('a');
  });

  it('notifies subscribers on record and stops after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = aiUsageTracker.subscribe(cb);
    aiUsageTracker.record({ totalTokens: 10 }, 'writer', 1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    aiUsageTracker.record({ totalTokens: 20 }, 'writer', 2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clear(source) removes only that surface and notifies; no-op for an unknown source', () => {
    const cb = vi.fn();
    aiUsageTracker.record({ totalTokens: 10 }, 'writer', 1);
    aiUsageTracker.record({ totalTokens: 20 }, 'copilot', 2);
    const unsub = aiUsageTracker.subscribe(cb);

    aiUsageTracker.clear('writer');
    expect(aiUsageTracker.getLast('writer')).toBeNull();
    expect(aiUsageTracker.getLast('copilot')?.totalTokens).toBe(20);
    expect(cb).toHaveBeenCalledTimes(1);

    // Clearing an unknown source must not notify (delete returns false).
    aiUsageTracker.clear('nope');
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('reset clears the snapshot and notifies', () => {
    const cb = vi.fn();
    // QNBS-v3 (CodeAnt): capture + call unsubscribe so this listener doesn't leak across tests
    // (reset() clears snapshots, not listeners).
    const unsub = aiUsageTracker.subscribe(cb);
    aiUsageTracker.record({ totalTokens: 10 }, 'writer', 1);
    aiUsageTracker.reset();
    expect(aiUsageTracker.getLast('writer')).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
  });
});
