// @vitest-environment node
// QNBS-v3: node environment avoids jsdom's non-configurable indexedDB stub — real IDB is required to prove the reset-retry fix (ensureDb() replacing the old one-shot dbReady promise).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiInferenceCacheService } from '../../../../services/ai/aiInferenceCacheService';
import {
  _resetIdbResetGateForTest,
  beginIdbReset,
  endIdbReset,
} from '../../../../services/storage/idbResetGate';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  _resetIdbResetGateForTest();
});

afterEach(() => {
  _resetIdbResetGateForTest();
});

describe('AiInferenceCacheService — reset retry', () => {
  // QNBS-v3: the original one-shot dbReady promise permanently fell back to in-memory-only for the rest of the session once the first open lost a race with a reset; ensureDb() must retry.
  // Reads go through a SEPARATE fresh instance (empty in-memory LRU) so this proves the write
  // actually reached durable IDB, not just the writer's own in-memory cache.
  it('durably caches to IDB again after a factory reset begins and is then aborted', async () => {
    const writer = new AiInferenceCacheService();

    // QNBS-v3 (cubic): begins cleanly and is then aborted before reaching deletion/reload -- exercises the post-abort retry path, not a closer failure.
    await beginIdbReset();
    endIdbReset();

    await writer.setCachedInference('prompt-a', 'model-a', 'result-a');

    const reader = new AiInferenceCacheService();
    expect(await reader.getCachedInference('prompt-a', 'model-a')).toBe('result-a');
  });

  // QNBS-v3: unlike the tests above (open, THEN reset, THEN open again sequentially), this exercises the actual generation race: the reset begins WHILE this open is still in flight, before its onsuccess has fired.
  it('discards an open that was already in flight when a reset begins before it completes, then durably retries after the reset ends', async () => {
    const writer = new AiInferenceCacheService();

    // Starts the IDB open synchronously (ensureDb() -> openDb() -> indexedDB.open(), all within
    // this call's synchronous prefix before it yields on `await this.ensureDb()`).
    const staleWrite = writer.setCachedInference('stale', 'model-a', 'stale-result');

    // The generation bump inside beginIdbReset() happens synchronously, before the pending open's
    // onsuccess can possibly fire — this is the actual race the admission/generation pair closes.
    await beginIdbReset();
    endIdbReset();

    // The in-flight open must have discarded itself (either still-resetting or generation-mismatch,
    // depending on exactly when its onsuccess fired) rather than caching an invalidated connection —
    // the write silently no-ops (cache is best-effort/non-authoritative) instead of throwing.
    await expect(staleWrite).resolves.toBeUndefined();
    expect(await new AiInferenceCacheService().getCachedInference('stale', 'model-a')).toBeNull();

    // A fresh attempt after the reset ended must retry and durably succeed.
    await writer.setCachedInference('retry', 'model-a', 'retry-result');
    expect(await new AiInferenceCacheService().getCachedInference('retry', 'model-a')).toBe(
      'retry-result',
    );
  });

  it('discards a connection opened before a reset and durably re-opens fresh afterward', async () => {
    type CacheInternals = { db: IDBDatabase | null };
    const writer = new AiInferenceCacheService();
    const internals = writer as unknown as CacheInternals;

    // Warm the connection before any reset exists.
    await writer.setCachedInference('warm', 'model-a', 'warm-result');
    expect(await new AiInferenceCacheService().getCachedInference('warm', 'model-a')).toBe(
      'warm-result',
    );
    // QNBS-v3: a durable post-reset round-trip alone doesn't prove the pre-reset connection actually closed — a still-open connection would pass it too. Capture identity to prove a genuine re-open happened.
    const preResetDb = internals.db;
    expect(preResetDb).not.toBeNull();

    await beginIdbReset();
    endIdbReset();

    // The reset's registered closer must have closed the pre-reset connection synchronously.
    expect(internals.db).toBeNull();

    // The pre-reset connection must be gone — a fresh write still durably round-trips.
    await writer.setCachedInference('after-reset', 'model-a', 'after-reset-result');
    expect(await new AiInferenceCacheService().getCachedInference('after-reset', 'model-a')).toBe(
      'after-reset-result',
    );
    // QNBS-v3: proves a genuinely NEW connection was opened, not the same pre-reset object somehow surviving.
    expect(internals.db).not.toBeNull();
    expect(internals.db).not.toBe(preResetDb);
  });

  // QNBS-v3 (CodeAnt): the reset closer previously cleared only `db`, not `openPromise` -- a call made before the stale (invalidated) open settled would reuse that same promise instead of starting a fresh attempt.
  it('clears the in-flight openPromise on reset so a call made before it settles starts a fresh attempt', async () => {
    type CacheInternals = { openPromise: Promise<void> | null };
    const writer = new AiInferenceCacheService();
    const internals = writer as unknown as CacheInternals;

    const staleWrite = writer.setCachedInference('stale', 'model-a', 'stale-result');
    const staleOpenPromise = internals.openPromise;
    expect(staleOpenPromise).not.toBeNull();

    // The generation bump happens synchronously, before the stale open's onsuccess can fire.
    await beginIdbReset();
    endIdbReset();

    expect(internals.openPromise).toBeNull();

    const retryWrite = writer.setCachedInference('retry', 'model-a', 'retry-result');
    // QNBS-v3: a genuinely new attempt, not the stale in-flight promise handed back again.
    expect(internals.openPromise).not.toBeNull();
    expect(internals.openPromise).not.toBe(staleOpenPromise);

    await Promise.all([staleWrite, retryWrite]);
    expect(await new AiInferenceCacheService().getCachedInference('retry', 'model-a')).toBe(
      'retry-result',
    );
  });
});
