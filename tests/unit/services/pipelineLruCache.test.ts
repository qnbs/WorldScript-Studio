import { describe, expect, it, vi } from 'vitest';
import { MAX_PIPELINE_CACHE, PipelineLruCache } from '../../../services/ai/pipelineLruCache';

// QNBS-v3: deterministic clock — each read returns a strictly increasing tick so LRU recency
//          is unambiguous without real timers.
function makeClock() {
  let t = 0;
  return () => ++t;
}

describe('pipelineLruCache', () => {
  it('exports the default cache cap', () => {
    expect(MAX_PIPELINE_CACHE).toBe(8);
  });

  it('returns undefined on miss and the value on hit', () => {
    const cache = new PipelineLruCache<string>({ now: makeClock() });
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 'pipe-a');
    expect(cache.get('a')).toBe('pipe-a');
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('evicts the least-recently-used entry when at capacity', () => {
    const cache = new PipelineLruCache<string>({ maxSize: 2, now: makeClock() });
    cache.set('a', 'A');
    cache.set('b', 'B');
    // Touch 'a' so 'b' becomes the LRU.
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C'); // capacity 2 → must evict 'b'
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('disposes the value when it is evicted', () => {
    const dispose = vi.fn();
    const cache = new PipelineLruCache<string>({ maxSize: 1, now: makeClock(), dispose });
    cache.set('a', 'A');
    cache.set('b', 'B'); // evicts 'a'
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith('A');
  });

  it('disposes the previous value when a live key is replaced', () => {
    const dispose = vi.fn();
    const cache = new PipelineLruCache<string>({ maxSize: 4, now: makeClock(), dispose });
    cache.set('a', 'A1');
    cache.set('a', 'A2'); // replace → old value released
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith('A1');
    expect(cache.get('a')).toBe('A2');
    expect(cache.size).toBe(1);
  });

  it('does not dispose when set is called with the identical value', () => {
    const dispose = vi.fn();
    const cache = new PipelineLruCache<string>({ now: makeClock(), dispose });
    cache.set('a', 'A');
    cache.set('a', 'A'); // idempotent touch — no dispose
    expect(dispose).not.toHaveBeenCalled();
  });

  it('swallows a synchronous dispose throw without breaking eviction', () => {
    const cache = new PipelineLruCache<string>({
      maxSize: 1,
      now: makeClock(),
      dispose: () => {
        throw new Error('sync dispose boom');
      },
    });
    cache.set('a', 'A');
    expect(() => cache.set('b', 'B')).not.toThrow();
    expect(cache.has('b')).toBe(true);
    expect(cache.has('a')).toBe(false);
  });

  it('swallows an async dispose rejection (no unhandled rejection on evict)', async () => {
    const cache = new PipelineLruCache<string>({
      maxSize: 1,
      now: makeClock(),
      dispose: () => Promise.reject(new Error('async dispose boom')),
    });
    cache.set('a', 'A');
    expect(() => cache.set('b', 'B')).not.toThrow();
    // Let the rejected disposal microtask settle; the test fails loudly if it goes unhandled.
    await Promise.resolve();
    expect(cache.has('b')).toBe(true);
  });

  it('disposes every value on clear()', () => {
    const dispose = vi.fn();
    const cache = new PipelineLruCache<string>({ maxSize: 4, now: makeClock(), dispose });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.clear();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('clamps maxSize to a floor of 1', () => {
    const dispose = vi.fn();
    const cache = new PipelineLruCache<string>({ maxSize: 0, now: makeClock(), dispose });
    cache.set('a', 'A');
    cache.set('b', 'B'); // floor of 1 → 'a' evicted
    expect(cache.size).toBe(1);
    expect(cache.has('b')).toBe(true);
    expect(dispose).toHaveBeenCalledWith('A');
  });

  describe('getOrLoad', () => {
    it('loads and caches on miss, serves from cache on the second call', async () => {
      const cache = new PipelineLruCache<string>({ now: makeClock() });
      const loader = vi.fn().mockResolvedValue('loaded');
      expect(await cache.getOrLoad('k', loader)).toBe('loaded');
      expect(await cache.getOrLoad('k', loader)).toBe('loaded');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('dedups concurrent loads of the same key into one loader call', async () => {
      const cache = new PipelineLruCache<string>({ now: makeClock() });
      let resolve!: (v: string) => void;
      const loader = vi.fn().mockReturnValue(
        new Promise<string>((r) => {
          resolve = r;
        }),
      );
      const p1 = cache.getOrLoad('k', loader);
      const p2 = cache.getOrLoad('k', loader);
      resolve('shared');
      expect(await p1).toBe('shared');
      expect(await p2).toBe('shared');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('does not poison the cache when a load rejects, and retries on next call', async () => {
      const cache = new PipelineLruCache<string>({ now: makeClock() });
      const loader = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
      await expect(cache.getOrLoad('k', loader)).rejects.toThrow('boom');
      expect(cache.has('k')).toBe(false);
      expect(await cache.getOrLoad('k', loader)).toBe('ok');
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
