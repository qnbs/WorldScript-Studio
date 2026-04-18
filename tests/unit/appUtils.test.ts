import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../../app/utils';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('calls the wrapped function only once after delay', () => {
    const fn = vi.fn<(...args: unknown[]) => void>();
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('preserves this binding and latest arguments', () => {
    const target = {
      total: 0,
      add(this: { total: number }, value: unknown) {
        if (typeof value === 'number') {
          this.total += value;
        }
      },
    };

    const debounced = debounce(target.add, 50);

    debounced.call(target, 2);
    debounced.call(target, 5);

    vi.advanceTimersByTime(50);

    expect(target.total).toBe(5);
  });
});
