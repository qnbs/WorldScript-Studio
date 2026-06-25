// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _clearHeuristicRegistry,
  _resetHeuristicFallbackEvents,
  applyHeuristicFallback,
  getLastHeuristicFallback,
  makeHeuristicResult,
  registerHeuristicGenerator,
  subscribeHeuristicFallback,
} from '../../services/ai/heuristicFallback';

describe('applyHeuristicFallback (seam + events)', () => {
  beforeEach(() => {
    _clearHeuristicRegistry();
    _resetHeuristicFallbackEvents();
  });

  it('returns the heuristic result and records a fallback event', () => {
    registerHeuristicGenerator('outline', () =>
      makeHeuristicResult([{ title: 'Ch 1' }], {
        confidence: 0.6,
        tier: 'advanced',
        reasonKey: 'error.fallback.offline',
      }),
    );
    const events: unknown[] = [];
    const unsub = subscribeHeuristicFallback((e) => events.push(e));

    const result = applyHeuristicFallback(
      'outline',
      { reasonKey: 'error.fallback.offline' },
      () => 123,
    );

    expect(result?.data).toEqual([{ title: 'Ch 1' }]);
    expect(getLastHeuristicFallback()).toEqual({
      task: 'outline',
      reasonKey: 'error.fallback.offline',
      confidence: 0.6,
      tier: 'advanced',
      at: 123,
    });
    expect(events).toHaveLength(1);
    unsub();
  });

  it('records nothing and returns null when no generator is registered', () => {
    const events: unknown[] = [];
    subscribeHeuristicFallback((e) => events.push(e));
    expect(applyHeuristicFallback('missing', {})).toBeNull();
    expect(getLastHeuristicFallback()).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('does not record when the generator declines (returns null)', () => {
    registerHeuristicGenerator('decline', () => null);
    expect(applyHeuristicFallback('decline', {})).toBeNull();
    expect(getLastHeuristicFallback()).toBeNull();
  });

  it('a throwing subscriber does not break the seam', () => {
    registerHeuristicGenerator('t', () =>
      makeHeuristicResult('x', { confidence: 0.5, tier: 'basic' }),
    );
    subscribeHeuristicFallback(() => {
      throw new Error('subscriber bug');
    });
    expect(() => applyHeuristicFallback('t', {})).not.toThrow();
    expect(getLastHeuristicFallback()?.task).toBe('t');
  });
});
