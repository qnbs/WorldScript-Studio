import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../src/circuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and allows execution', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after threshold failures within window', () => {
    const cb = new CircuitBreaker(3, 60_000, 30_000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('closes again after recovery time + success', () => {
    const cb = new CircuitBreaker(1, 60_000, 1_000);
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    vi.advanceTimersByTime(1_001);
    expect(cb.getState()).toBe('half-open');
    expect(cb.canExecute()).toBe(true);
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('returns to open if half-open test fails', () => {
    const cb = new CircuitBreaker(1, 60_000, 1_000);
    cb.recordFailure();
    vi.advanceTimersByTime(1_001);
    expect(cb.canExecute()).toBe(true); // half-open test
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('only allows one test request in half-open', () => {
    const cb = new CircuitBreaker(1, 60_000, 1_000);
    cb.recordFailure();
    vi.advanceTimersByTime(1_001);
    expect(cb.canExecute()).toBe(true);
    expect(cb.canExecute()).toBe(false);
  });

  it('prunes failures outside window', () => {
    const cb = new CircuitBreaker(2, 5_000, 30_000);
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.recordFailure();
    // first failure is pruned, so still closed
    expect(cb.getState()).toBe('closed');
  });
});
