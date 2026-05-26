/**
 * Tests for features/progressTracker/progressTrackerSlice.ts — computeStreak pure function
 * QNBS-v3: Uses fake timers to control "today"; tests streak calculations deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeStreak } from '../../../features/progressTracker/progressTrackerSlice';

describe('computeStreak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "today" to 2026-05-26 so current-streak tests are deterministic
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns { current: 0, longest: 0 } for empty history', () => {
    expect(computeStreak([])).toEqual({ current: 0, longest: 0 });
  });

  it('returns zeros when all entries have 0 words', () => {
    const history = [
      { date: '2026-05-25', words: 0 },
      { date: '2026-05-26', words: 0 },
    ];
    expect(computeStreak(history)).toEqual({ current: 0, longest: 0 });
  });

  it('returns { current: 1, longest: 1 } for single entry today', () => {
    const history = [{ date: '2026-05-26', words: 500 }];
    expect(computeStreak(history)).toEqual({ current: 1, longest: 1 });
  });

  it('returns current 0 when latest entry is not today', () => {
    const history = [{ date: '2026-05-24', words: 300 }];
    const result = computeStreak(history);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(1);
  });

  it('computes current streak for consecutive days ending today', () => {
    const history = [
      { date: '2026-05-24', words: 100 },
      { date: '2026-05-25', words: 200 },
      { date: '2026-05-26', words: 300 },
    ];
    expect(computeStreak(history).current).toBe(3);
  });

  it('stops current streak at gap', () => {
    const history = [
      { date: '2026-05-23', words: 100 },
      // gap: 2026-05-24 missing
      { date: '2026-05-25', words: 200 },
      { date: '2026-05-26', words: 300 },
    ];
    expect(computeStreak(history).current).toBe(2); // only 25+26
  });

  it('computes longest streak across a longer sequence', () => {
    const history = [
      { date: '2026-05-20', words: 100 },
      { date: '2026-05-21', words: 100 },
      { date: '2026-05-22', words: 100 },
      // gap
      { date: '2026-05-25', words: 100 },
      { date: '2026-05-26', words: 100 },
    ];
    expect(computeStreak(history).longest).toBe(3);
  });

  it('deduplicates entries with the same date', () => {
    const history = [
      { date: '2026-05-26', words: 100 },
      { date: '2026-05-26', words: 200 }, // duplicate date
    ];
    const result = computeStreak(history);
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });

  it('ignores zero-word entries in streak calculation', () => {
    const history = [
      { date: '2026-05-25', words: 0 },
      { date: '2026-05-26', words: 500 },
    ];
    expect(computeStreak(history).current).toBe(1);
  });
});
