// @vitest-environment node
/**
 * Tests for idbCore pure utility functions.
 * QNBS-v3: Covers compressData/decompressData round-trip, retryDb backoff logic,
 * and getUserFriendlyDbError message mapping — all without opening IndexedDB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compressData,
  decompressData,
  getUserFriendlyDbError,
  retryDb,
} from '../../../services/storage/idbCore';

// ---------------------------------------------------------------------------
// compressData / decompressData
// ---------------------------------------------------------------------------

describe('compressData / decompressData', () => {
  it('round-trips a small object without compression (under threshold)', () => {
    const data = { title: 'My Story', author: 'Alice' };
    const compressed = compressData(data);
    // Small objects pass through as-is (no string prefix)
    expect(typeof compressed).toBe('object');
    const restored = decompressData<typeof data>(compressed);
    expect(restored).toEqual(data);
  });

  it('compresses and round-trips large objects (≥10 KB)', () => {
    const largeString = 'x'.repeat(11_000);
    const data = { content: largeString };
    const compressed = compressData(data);
    // Should be a string with the lz1 prefix (NUL + "lz1" + NUL marker)
    expect(typeof compressed).toBe('string');
    expect(compressed as string).toContain('lz1');
    const restored = decompressData<typeof data>(compressed);
    expect(restored.content).toBe(largeString);
  });

  it('decompressData returns the original value for non-compressed strings', () => {
    const plain = 'just a plain string';
    expect(decompressData(plain)).toBe(plain);
  });

  it('decompressData returns non-string values as-is', () => {
    expect(decompressData(42)).toBe(42);
    expect(decompressData(null)).toBeNull();
    expect(decompressData(true)).toBe(true);
    const obj = { a: 1 };
    expect(decompressData(obj)).toEqual(obj);
  });

  it('compressData returns data as-is when JSON.stringify fails', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test circular ref
    const circular: any = {};
    circular.self = circular;
    // Should not throw; returns the original (un-serialisable) value
    const result = compressData(circular);
    expect(result).toBe(circular);
  });

  it('decompressData returns fallback for corrupted lz1 content', () => {
    const corrupted = '\x00lz1\x00not-valid-lz-data';
    // Should not throw; returns corrupted string as-is after failed decompress/parse
    const result = decompressData<{ content: string }>(corrupted);
    // Falls back to raw as unknown, implementation catches and returns raw
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// retryDb
// ---------------------------------------------------------------------------

describe('retryDb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when fn succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryDb(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient QuotaExceededError then succeeds', async () => {
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    const fn = vi.fn().mockRejectedValueOnce(quota).mockResolvedValueOnce('recovered');

    const promise = retryDb(fn, 2, 10);
    // Advance timers to skip delay
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on InvalidStateError', async () => {
    const err = new DOMException('Invalid state', 'InvalidStateError');
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');

    const promise = retryDb(fn, 2, 10);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });

  it('retries on AbortError', async () => {
    const err = new DOMException('Aborted', 'AbortError');
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');

    const promise = retryDb(fn, 2, 10);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });

  it('does NOT retry on non-transient errors', async () => {
    const err = new Error('Syntax error in data');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryDb(fn, 2, 10)).rejects.toThrow('Syntax error in data');
    // Only called once — no retry for non-DOMException errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately with retries=0 (no retry path)', async () => {
    // retries=0 means 1 attempt only, no setTimeout is created → no timer leak
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    const fn = vi.fn().mockRejectedValue(quota);
    await expect(retryDb(fn, 0)).rejects.toBe(quota);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fn is called again after a transient error (retry count verified via success path)', async () => {
    // Verify retry count indirectly: fn called twice = 1 retry happened.
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    const fn = vi.fn().mockRejectedValueOnce(quota).mockResolvedValueOnce('second-attempt-ok');
    const promise = retryDb(fn, 1, 0);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('second-attempt-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getUserFriendlyDbError
// ---------------------------------------------------------------------------

describe('getUserFriendlyDbError', () => {
  it('returns storage-exhausted message for QuotaExceededError', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    const msg = getUserFriendlyDbError(err);
    expect(msg).toMatch(/storage is exhausted/i);
  });

  it('returns reload-page message for InvalidStateError', () => {
    const err = new DOMException('Invalid state', 'InvalidStateError');
    expect(getUserFriendlyDbError(err)).toMatch(/reload/i);
  });

  it('returns reload-page message for TransactionInactiveError', () => {
    const err = new DOMException('Transaction inactive', 'TransactionInactiveError');
    expect(getUserFriendlyDbError(err)).toMatch(/reload/i);
  });

  it('returns aborted message for AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(getUserFriendlyDbError(err)).toMatch(/aborted/i);
  });

  it('returns the Error.message for generic errors', () => {
    const err = new Error('Custom error message');
    expect(getUserFriendlyDbError(err)).toBe('Custom error message');
  });

  it('returns fallback string for non-Error unknown values', () => {
    expect(getUserFriendlyDbError(null)).toMatch(/unknown/i);
    expect(getUserFriendlyDbError(undefined)).toMatch(/unknown/i);
    expect(getUserFriendlyDbError(42)).toMatch(/unknown/i);
  });
});
