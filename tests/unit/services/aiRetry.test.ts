/**
 * Tests for services/ai/aiRetry.ts
 * QNBS-v3: Pure retry logic — covers success on first try, retry on transient failure,
 *          exhaustion after max attempts, non-Error rethrow wrapping, and custom opts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: aiRetry now emits structured logs on retry decisions — stub the logger so tests stay
// deterministic and free of IDB/console side effects.
vi.mock('../../../services/logger', () => {
  const noop = (): void => {};
  const make = (): Record<string, unknown> => ({
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    withContext: () => make(),
  });
  return { createLogger: () => make() };
});

import {
  AI_RETRY_BASE_DELAY_MS,
  AI_RETRY_MAX_DELAY_MS,
  AI_RETRY_MAX_RETRY_AFTER_MS,
  computeRetryDelayMs,
  DEFAULT_AI_RETRY_ATTEMPTS,
  parseRetryAfterMs,
  withTransientRetry,
} from '../../../services/ai/aiRetry';

describe('aiRetry', () => {
  describe('constants', () => {
    it('DEFAULT_AI_RETRY_ATTEMPTS is 2', () => {
      expect(DEFAULT_AI_RETRY_ATTEMPTS).toBe(2);
    });

    it('AI_RETRY_BASE_DELAY_MS is 400', () => {
      expect(AI_RETRY_BASE_DELAY_MS).toBe(400);
    });
  });

  describe('withTransientRetry — no-delay paths', () => {
    it('resolves immediately when fn succeeds on first try', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withTransientRetry(fn, { attempts: 1 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('wraps non-Error rejections in an Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');
      // QNBS-v3: baseDelayMs:0 avoids fake-timer interaction; single attempt, no retry.
      await expect(withTransientRetry(fn, { attempts: 1, baseDelayMs: 0 })).rejects.toBeInstanceOf(
        Error,
      );
    });

    it('resolves without delay when attempts is 1 and fn succeeds', async () => {
      const fn = vi.fn().mockResolvedValue(42);
      const result = await withTransientRetry(fn, { attempts: 1 });
      expect(result).toBe(42);
    });
  });

  describe('withTransientRetry — fake-timer paths', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries once and succeeds on second attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('success');

      // QNBS-v3: Attach rejection handler BEFORE runAllTimersAsync to avoid unhandled rejection.
      const check = expect(withTransientRetry(fn, { attempts: 2, baseDelayMs: 100 })).resolves.toBe(
        'success',
      );
      await vi.runAllTimersAsync();
      await check;
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after all attempts are exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      const check = expect(
        withTransientRetry(fn, { attempts: 3, baseDelayMs: 10 }),
      ).rejects.toThrow('always fails');
      await vi.runAllTimersAsync();
      await check;
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses default attempts (2) when not specified', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const check = expect(withTransientRetry(fn, { baseDelayMs: 10 })).rejects.toThrow('fail');
      await vi.runAllTimersAsync();
      await check;
      expect(fn).toHaveBeenCalledTimes(DEFAULT_AI_RETRY_ATTEMPTS);
    });

    it('applies exponential backoff between retries', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValueOnce('done');

      const check = expect(withTransientRetry(fn, { attempts: 3, baseDelayMs: 100 })).resolves.toBe(
        'done',
      );
      await vi.runAllTimersAsync();
      await check;
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('honors a server Retry-After over the computed backoff', async () => {
      // QNBS-v3: computed delay would be 100ms; Retry-After dictates 5000ms — the call must
      //          still be in-flight at 100ms and only resolve after the server-directed wait.
      const err = Object.assign(new Error('429'), { retryAfterMs: 5000 });
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
      const check = expect(
        withTransientRetry(fn, { attempts: 2, baseDelayMs: 100, jitter: false }),
      ).resolves.toBe('ok');
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4900);
      await check;
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('computeRetryDelayMs — invariants', () => {
    // QNBS-v3: rng fixed to 1 makes full-jitter a no-op (scale ×1) → asserts the *capped* delay.
    const noJitter = { jitter: false } as const;

    it('is exponential in attemptIndex up to the cap (jitter off)', () => {
      const base = 100;
      expect(computeRetryDelayMs(0, { baseDelayMs: base, ...noJitter })).toBe(100);
      expect(computeRetryDelayMs(1, { baseDelayMs: base, ...noJitter })).toBe(200);
      expect(computeRetryDelayMs(2, { baseDelayMs: base, ...noJitter })).toBe(400);
      expect(computeRetryDelayMs(3, { baseDelayMs: base, ...noJitter })).toBe(800);
    });

    it('is non-decreasing in attemptIndex and never exceeds maxDelayMs', () => {
      let prev = -1;
      for (let i = 0; i < 20; i++) {
        const d = computeRetryDelayMs(i, { baseDelayMs: 400, ...noJitter });
        expect(d).toBeGreaterThanOrEqual(prev);
        expect(d).toBeLessThanOrEqual(AI_RETRY_MAX_DELAY_MS);
        prev = d;
      }
    });

    it('full jitter keeps the delay within [0, capped) for any rng output', () => {
      for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.999]) {
        const capped = computeRetryDelayMs(3, { baseDelayMs: 100, jitter: false });
        const jittered = computeRetryDelayMs(3, { baseDelayMs: 100, rng: () => r });
        expect(jittered).toBeGreaterThanOrEqual(0);
        expect(jittered).toBeLessThanOrEqual(capped);
        expect(jittered).toBeCloseTo(r * capped, 6);
      }
    });

    it('clamps the raw exponential growth at maxDelayMs', () => {
      // attemptIndex 10 → 400 * 2^10 = 409 600, far above the 8 000 ceiling.
      expect(computeRetryDelayMs(10, { baseDelayMs: 400, ...noJitter })).toBe(
        AI_RETRY_MAX_DELAY_MS,
      );
    });
  });

  describe('parseRetryAfterMs', () => {
    it('returns null when no hint is present', () => {
      expect(parseRetryAfterMs(null)).toBeNull();
      expect(parseRetryAfterMs(new Error('plain'))).toBeNull();
      expect(parseRetryAfterMs({})).toBeNull();
    });

    it('reads an explicit millisecond hint, clamped to the ceiling', () => {
      expect(parseRetryAfterMs({ retryAfterMs: 1500 })).toBe(1500);
      expect(parseRetryAfterMs({ retryAfterMs: 10 ** 9 })).toBe(AI_RETRY_MAX_RETRY_AFTER_MS);
    });

    it('reads retryAfter as delta-seconds (number) and (string)', () => {
      expect(parseRetryAfterMs({ retryAfter: 3 })).toBe(3000);
      expect(parseRetryAfterMs({ retryAfter: '2' })).toBe(2000);
    });

    it('falls back to a Retry-After header on the error or its response', () => {
      const onError = { headers: { get: (n: string) => (n === 'retry-after' ? '4' : null) } };
      expect(parseRetryAfterMs(onError)).toBe(4000);
      const onResponse = {
        response: { headers: { get: (n: string) => (n === 'retry-after' ? '6' : null) } },
      };
      expect(parseRetryAfterMs(onResponse)).toBe(6000);
    });

    it('clamps a hostile/huge server value to AI_RETRY_MAX_RETRY_AFTER_MS', () => {
      expect(parseRetryAfterMs({ retryAfter: 10 ** 6 })).toBe(AI_RETRY_MAX_RETRY_AFTER_MS);
    });
  });

  describe('withTransientRetry — fail-fast classification', () => {
    it('does not retry a non-retryable auth error (401)', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      const fn = vi.fn().mockRejectedValue(err);
      await expect(withTransientRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow(
        'Unauthorized',
      );
      // QNBS-v3: classified as auth → fails fast; fn invoked exactly once, no backoff.
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry a policy-blocked error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValue(new Error('Cloud provider blocked: local-only mode is active.'));
      await expect(withTransientRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow(
        /blocked/,
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('still retries a transient error by default classification', async () => {
      vi.useFakeTimers();
      try {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('socket hang up'))
          .mockResolvedValueOnce('ok');
        const check = expect(
          withTransientRetry(fn, { attempts: 2, baseDelayMs: 10 }),
        ).resolves.toBe('ok');
        await vi.runAllTimersAsync();
        await check;
        expect(fn).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a custom shouldRetry=false short-circuits an otherwise-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('socket hang up')); // transient → retryable
      await expect(
        withTransientRetry(fn, { attempts: 3, baseDelayMs: 0, shouldRetry: () => false }),
      ).rejects.toThrow('socket hang up');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('a custom shouldRetry=true forces retry of an otherwise-non-retryable error', async () => {
      vi.useFakeTimers();
      try {
        const err = Object.assign(new Error('Unauthorized'), { status: 401 });
        const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('recovered');
        const check = expect(
          withTransientRetry(fn, { attempts: 2, baseDelayMs: 10, shouldRetry: () => true }),
        ).resolves.toBe('recovered');
        await vi.runAllTimersAsync();
        await check;
        expect(fn).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
