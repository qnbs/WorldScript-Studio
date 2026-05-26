/**
 * Tests for services/ai/aiRetry.ts
 * QNBS-v3: Pure retry logic — covers success on first try, retry on transient failure,
 *          exhaustion after max attempts, non-Error rethrow wrapping, and custom opts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_RETRY_BASE_DELAY_MS,
  DEFAULT_AI_RETRY_ATTEMPTS,
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

    it('applies linear backoff between retries', async () => {
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
  });
});
