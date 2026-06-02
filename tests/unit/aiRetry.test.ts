/**
 * aiRetry tests — exponential backoff, full jitter, Retry-After parsing.
 * QNBS-v3: P1-F5. Deterministic via injected rng + baseDelayMs:0 (no real waits / timers).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AI_RETRY_MAX_RETRY_AFTER_MS,
  computeRetryDelayMs,
  parseRetryAfterMs,
  withTransientRetry,
} from '../../services/ai/aiRetry';

describe('computeRetryDelayMs', () => {
  it('grows exponentially when jitter is off', () => {
    const o = { baseDelayMs: 100, jitter: false };
    expect(computeRetryDelayMs(0, o)).toBe(100);
    expect(computeRetryDelayMs(1, o)).toBe(200);
    expect(computeRetryDelayMs(2, o)).toBe(400);
    expect(computeRetryDelayMs(3, o)).toBe(800);
  });

  it('caps the computed delay at maxDelayMs', () => {
    const o = { baseDelayMs: 100, maxDelayMs: 250, jitter: false };
    expect(computeRetryDelayMs(2, o)).toBe(250);
    expect(computeRetryDelayMs(10, o)).toBe(250);
  });

  it('applies full jitter scaled by rng within [0, capped]', () => {
    const base = { baseDelayMs: 100, maxDelayMs: 800 };
    expect(computeRetryDelayMs(2, { ...base, rng: () => 0 })).toBe(0);
    expect(computeRetryDelayMs(2, { ...base, rng: () => 0.5 })).toBe(200); // 0.5 * 400
    expect(computeRetryDelayMs(2, { ...base, rng: () => 0.999 })).toBeCloseTo(399.6, 1);
  });
});

describe('parseRetryAfterMs', () => {
  it('returns null for non-objects and empty errors', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('boom')).toBeNull();
    expect(parseRetryAfterMs(new Error('x'))).toBeNull();
  });

  it('reads an explicit millisecond hint', () => {
    expect(parseRetryAfterMs({ retryAfterMs: 1500 })).toBe(1500);
  });

  it('reads retryAfter as seconds', () => {
    expect(parseRetryAfterMs({ retryAfter: 3 })).toBe(3000);
  });

  it('reads a delta-seconds Retry-After header', () => {
    const err = { headers: { get: (n: string) => (n === 'retry-after' ? '5' : null) } };
    expect(parseRetryAfterMs(err)).toBe(5000);
  });

  it('reads a header from the response object', () => {
    const err = { response: { headers: { get: () => '2' } } };
    expect(parseRetryAfterMs(err)).toBe(2000);
  });

  it('falls back to a valid header when the direct retryAfter string is unparseable', () => {
    const err = { retryAfter: 'bogus', headers: { get: () => '5' } };
    expect(parseRetryAfterMs(err)).toBe(5000);
  });

  it('clamps to the max Retry-After ceiling', () => {
    expect(parseRetryAfterMs({ retryAfterMs: 10 * 60 * 1000 })).toBe(AI_RETRY_MAX_RETRY_AFTER_MS);
  });
});

describe('withTransientRetry', () => {
  const fast = { baseDelayMs: 0, jitter: false };

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withTransientRetry(fn, { ...fast, attempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');
    await expect(withTransientRetry(fn, { ...fast, attempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(withTransientRetry(fn, { ...fast, attempts: 2 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors a Retry-After hint on the error path', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { retryAfterMs: 0 }))
      .mockResolvedValue('ok');
    await expect(withTransientRetry(fn, { attempts: 2 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
