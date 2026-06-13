import { describe, expect, it, vi } from 'vitest';

// QNBS-v3: aiRetry emits structured logs on retry decisions — stub the logger to keep test
// output clean and deterministic.
vi.mock('../../services/logger', () => {
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

import { withTransientRetry } from '../../services/ai/aiRetry';

describe('withTransientRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withTransientRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    await expect(withTransientRetry(fn, { attempts: 2, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(withTransientRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow(
      'persistent',
    );
  });
});
