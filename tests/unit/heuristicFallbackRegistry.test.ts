// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _clearHeuristicRegistry,
  _registeredHeuristicTasks,
  clampConfidence,
  hasHeuristicGenerator,
  makeHeuristicResult,
  registerHeuristicGenerator,
  runHeuristicFallback,
} from '../../services/ai/heuristicFallback';

describe('heuristicFallback registry', () => {
  beforeEach(() => {
    _clearHeuristicRegistry();
  });

  it('runs a registered generator and returns its envelope', () => {
    registerHeuristicGenerator('writer.continue', (ctx) =>
      makeHeuristicResult(`echo:${ctx.prompt ?? ''}`, { confidence: 0.4, tier: 'basic' }),
    );
    const result = runHeuristicFallback<string>('writer.continue', { prompt: 'hi' });
    expect(result).toEqual({
      data: 'echo:hi',
      isFallback: true,
      confidence: 0.4,
      tier: 'basic',
      reasonKey: 'error.fallback.generic',
    });
  });

  it('returns null when there is no task or no registered generator', () => {
    expect(runHeuristicFallback('outline', {})).toBeNull();
    expect(runHeuristicFallback(undefined, {})).toBeNull();
    expect(hasHeuristicGenerator('outline')).toBe(false);
    expect(hasHeuristicGenerator(undefined)).toBe(false);
  });

  it('is idempotent — first registration wins', () => {
    registerHeuristicGenerator('t', () =>
      makeHeuristicResult('first', { confidence: 1, tier: 'advanced' }),
    );
    registerHeuristicGenerator('t', () =>
      makeHeuristicResult('second', { confidence: 1, tier: 'advanced' }),
    );
    expect(runHeuristicFallback<string>('t', {})?.data).toBe('first');
    expect(_registeredHeuristicTasks()).toEqual(['t']);
  });

  it('degrades safely to null when a generator throws', () => {
    registerHeuristicGenerator('boom', () => {
      throw new Error('generator bug');
    });
    expect(() => runHeuristicFallback('boom', {})).not.toThrow();
    expect(runHeuristicFallback('boom', {})).toBeNull();
  });

  it('returns null when a generator declines (returns null)', () => {
    registerHeuristicGenerator('decline', () => null);
    expect(runHeuristicFallback('decline', {})).toBeNull();
    expect(hasHeuristicGenerator('decline')).toBe(true);
  });

  it('passes the context through to the generator', () => {
    const spy = vi.fn(() => makeHeuristicResult('ok', { confidence: 0.5, tier: 'basic' }));
    registerHeuristicGenerator('ctx', spy);
    runHeuristicFallback('ctx', {
      prompt: 'p',
      params: { n: 3 },
      reasonKey: 'error.fallback.offline',
    });
    expect(spy).toHaveBeenCalledWith({
      prompt: 'p',
      params: { n: 3 },
      reasonKey: 'error.fallback.offline',
    });
  });
});

describe('heuristicFallback envelope helpers', () => {
  it('clampConfidence bounds to 0..1 and handles non-finite', () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(2)).toBe(1);
    expect(clampConfidence(Number.NaN)).toBe(0);
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('makeHeuristicResult builds a well-formed envelope and clamps confidence', () => {
    const result = makeHeuristicResult(
      { a: 1 },
      { confidence: 3, tier: 'advanced', reasonKey: 'error.fallback.offline' },
    );
    expect(result.isFallback).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.tier).toBe('advanced');
    expect(result.reasonKey).toBe('error.fallback.offline');
    expect(result.data).toEqual({ a: 1 });
  });

  it('makeHeuristicResult defaults the reasonKey', () => {
    expect(makeHeuristicResult('x', { confidence: 0.2, tier: 'basic' }).reasonKey).toBe(
      'error.fallback.generic',
    );
  });
});
