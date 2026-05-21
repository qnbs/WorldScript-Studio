import { describe, expect, it, vi } from 'vitest';
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
