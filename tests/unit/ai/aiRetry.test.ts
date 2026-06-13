/**
 * Tests for services/ai/aiRetry.ts
 * QNBS-v3: Covers delay computation, Retry-After parsing, and the withTransientRetry orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_RETRY_BASE_DELAY_MS,
  AI_RETRY_MAX_RETRY_AFTER_MS,
  computeRetryDelayMs,
  parseRetryAfterMs,
  withTransientRetry,
} from '../../../services/ai/aiRetry';

const mockClassify = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  withContext: vi.fn(() => mockLogger),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../services/ai/aiErrorTaxonomy', () => ({
  classifyAiError: (err: unknown) => mockClassify(err),
}));

vi.mock('../../../services/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

describe('computeRetryDelayMs', () => {
  it('returns 0 for attempt index 0 with no jitter', () => {
    const delay = computeRetryDelayMs(0, {
      baseDelayMs: 100,
      jitter: false,
    });
    expect(delay).toBe(100);
  });

  it('doubles the delay each attempt', () => {
    const delay = computeRetryDelayMs(2, {
      baseDelayMs: 100,
      jitter: false,
    });
    expect(delay).toBe(400);
  });

  it('caps delay at maxDelayMs', () => {
    const delay = computeRetryDelayMs(100, {
      baseDelayMs: 100,
      maxDelayMs: 500,
      jitter: false,
    });
    expect(delay).toBe(500);
  });

  it('uses default constants when options omitted', () => {
    const delay = computeRetryDelayMs(0, { jitter: false });
    expect(delay).toBe(AI_RETRY_BASE_DELAY_MS);
  });

  it('applies deterministic jitter', () => {
    const delay = computeRetryDelayMs(1, {
      baseDelayMs: 100,
      jitter: true,
      rng: () => 0.5,
    });
    expect(delay).toBe(100); // 200 * 0.5
  });

  it('clamps negative attempt index to 0', () => {
    const delay = computeRetryDelayMs(-3, {
      baseDelayMs: 100,
      jitter: false,
    });
    expect(delay).toBe(100);
  });
});

describe('parseRetryAfterMs', () => {
  it('returns null for non-object errors', () => {
    expect(parseRetryAfterMs('boom')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it('parses retryAfterMs milliseconds', () => {
    expect(parseRetryAfterMs({ retryAfterMs: 1500 })).toBe(1500);
  });

  it('clamps retryAfterMs to the maximum', () => {
    expect(parseRetryAfterMs({ retryAfterMs: AI_RETRY_MAX_RETRY_AFTER_MS + 1 })).toBe(
      AI_RETRY_MAX_RETRY_AFTER_MS,
    );
  });

  it('parses retryAfter seconds', () => {
    expect(parseRetryAfterMs({ retryAfter: 2 })).toBe(2000);
  });

  it('parses retry-after header delta-seconds', () => {
    expect(parseRetryAfterMs({ headers: { get: () => '5' } })).toBe(5000);
  });

  it('falls back to response headers', () => {
    expect(
      parseRetryAfterMs({
        headers: { get: () => null },
        response: { headers: { get: () => '3' } },
      }),
    ).toBe(3000);
  });

  it('prefers direct retryAfter string over header', () => {
    expect(
      parseRetryAfterMs({
        retryAfter: '1',
        headers: { get: () => '10' },
      }),
    ).toBe(1000);
  });

  it('returns null for unparseable strings', () => {
    expect(parseRetryAfterMs({ retryAfter: 'not-a-date' })).toBeNull();
  });

  it('ignores zero-length header values', () => {
    expect(parseRetryAfterMs({ headers: { get: () => '' } })).toBeNull();
  });
});

describe('withTransientRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClassify.mockReturnValue({ retryable: true, category: 'transient' });
  });

  // QNBS-v3: Retry-path tests fake the timer so backoff delays advance explicitly instead of
  // waiting on real wall-clock time; guaranteed restore here prevents fake timers from leaking
  // into later tests if an assertion throws early.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withTransientRetry(fn, { attempts: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and eventually succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const promise = withTransientRetry(fn, { attempts: 3, baseDelayMs: 1, jitter: false });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails fast on non-retryable error', async () => {
    mockClassify.mockReturnValue({ retryable: false, category: 'auth' });
    const fn = vi.fn().mockRejectedValue(new Error('auth'));
    await expect(
      withTransientRetry(fn, { attempts: 5, baseDelayMs: 1, jitter: false }),
    ).rejects.toThrow('auth');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws last error after exhausting attempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    const promise = withTransientRetry(fn, { attempts: 2, baseDelayMs: 1, jitter: false });
    const assertion = expect(promise).rejects.toThrow('persistent');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses Retry-After when present', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce({ retryAfterMs: 1 }).mockResolvedValue('ok');
    const promise = withTransientRetry(fn, { attempts: 2, baseDelayMs: 1000, jitter: false });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('wraps non-error throws in an Error', async () => {
    const fn = vi.fn().mockRejectedValue('string-error');
    await expect(withTransientRetry(fn, { attempts: 1 })).rejects.toThrow('string-error');
  });

  it('uses custom shouldRetry predicate', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error('maybe')).mockResolvedValue('ok');
    const shouldRetry = (err: unknown) => (err as Error).message === 'maybe';
    const promise = withTransientRetry(fn, {
      attempts: 2,
      baseDelayMs: 1,
      jitter: false,
      shouldRetry,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });
});
