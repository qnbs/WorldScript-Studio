// @vitest-environment node
/**
 * Tests for idbCore pure utility functions.
 * QNBS-v3: Covers compressData/decompressData round-trip, retryDb backoff logic,
 * and getUserFriendlyDbError message mapping — all without opening IndexedDB.
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_DB_NAME, STATE_DB_NAME } from '../../../services/dbConstants';
import {
  compressData,
  decompressData,
  getUserFriendlyDbError,
  IdbConnectionManager,
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
    const circular: { self?: unknown } = {};
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

// ---------------------------------------------------------------------------
// IdbConnectionManager — single-flight state/data opens (cubic)
// ---------------------------------------------------------------------------
describe('IdbConnectionManager — single-flight opens', () => {
  beforeEach(() => {
    global.indexedDB = new IDBFactory();
    global.IDBKeyRange = IDBKeyRange;
  });

  // QNBS-v3 (cubic): before this fix, concurrent initDB() calls made before the first open resolved each started their own indexedDB.open() -- the last onsuccess to fire silently overwrote stateDb/dataDb, orphaning every earlier connection untracked by closeConnections(), which could leave deleteDatabase() blocked during a factory reset.
  it('shares a single indexedDB.open() per database across concurrent initDB() callers', async () => {
    const manager = new IdbConnectionManager();
    const openSpy = vi.spyOn(indexedDB, 'open');

    await Promise.all([manager.initDB(), manager.initDB(), manager.initDB()]);

    const stateOpens = openSpy.mock.calls.filter(([name]) => name === STATE_DB_NAME);
    const dataOpens = openSpy.mock.calls.filter(([name]) => name === DATA_DB_NAME);
    expect(stateOpens).toHaveLength(1);
    expect(dataOpens).toHaveLength(1);
  });

  // QNBS-v3 (cubic): proves the single-flight guard doesn't outlive the connection it guarded -- after a close, a later initDB() must open fresh rather than reusing (or permanently skipping) the stale in-flight promise.
  it('opens fresh again after closeConnections(), rather than reusing the prior single-flight promise', async () => {
    type ManagerInternals = { closeConnections(): void };
    const manager = new IdbConnectionManager();
    const openSpy = vi.spyOn(indexedDB, 'open');

    await manager.initDB();
    expect(openSpy.mock.calls.filter(([name]) => name === STATE_DB_NAME)).toHaveLength(1);

    (manager as unknown as ManagerInternals).closeConnections();
    await manager.initDB();

    expect(openSpy.mock.calls.filter(([name]) => name === STATE_DB_NAME)).toHaveLength(2);
  });

  // QNBS-v3 (coderabbit): initDB() calls both openers unconditionally, and getObjectStore() calls initDB() whenever EITHER handle is still null -- without the live-handle guard, a later initDB() would reopen (and silently overwrite, unclosed) an already-live sibling database just because the other one still needed a fresh open.
  it('does not reopen an already-live database when only its sibling needs a fresh open', async () => {
    type ManagerInternals = { dataDb: IDBDatabase | null };
    const manager = new IdbConnectionManager();

    await manager.initDB();

    // QNBS-v3: simulates only the data connection going away (e.g. a versionchange close elsewhere) while state stays live -- getObjectStore() would call initDB() again in exactly this state.
    const internals = manager as unknown as ManagerInternals;
    internals.dataDb?.close();
    internals.dataDb = null;

    const openSpy = vi.spyOn(indexedDB, 'open');
    await manager.initDB();

    expect(openSpy.mock.calls.filter(([name]) => name === STATE_DB_NAME)).toHaveLength(0);
    expect(openSpy.mock.calls.filter(([name]) => name === DATA_DB_NAME)).toHaveLength(1);
  });
});
