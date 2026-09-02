// @vitest-environment node
/**
 * Tests for services/loraAdapterService.ts
 * QNBS-v3: Uses global.indexedDB = new IDBFactory() per test (node env, sceneRevisionService pattern).
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Reset IDB per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

// ---------------------------------------------------------------------------
// Import after global setup
// ---------------------------------------------------------------------------

import {
  _resetLoraDbForTest,
  deleteAdapter,
  getAdapterBlob,
  type LoraAdapterMeta,
  listAdapters,
  saveAdapter,
} from '../../services/loraAdapterService';
import {
  _resetIdbResetGateForTest,
  beginIdbReset,
  endIdbReset,
} from '../../services/storage/idbResetGate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const META: LoraAdapterMeta = {
  id: 'lora-1',
  name: 'Fantasy Style',
  description: 'Fantasy prose adapter',
  modelCompatibility: 'Phi-3.5-mini',
  scale: 0.8,
  fileSizeBytes: 512,
  createdAt: 1716000000000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listAdapters', () => {
  it('returns empty array when no adapters saved', async () => {
    const result = await listAdapters();
    expect(result).toEqual([]);
  });

  it('returns saved adapters', async () => {
    const blob = new ArrayBuffer(4);
    await saveAdapter(META, blob);
    const result = await listAdapters();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lora-1');
    expect(result[0]!.name).toBe('Fantasy Style');
  });
});

describe('saveAdapter', () => {
  it('persists meta fields correctly', async () => {
    await saveAdapter(META, new ArrayBuffer(4));
    const adapters = await listAdapters();
    expect(adapters[0]!.scale).toBe(0.8);
    expect(adapters[0]!.modelCompatibility).toBe('Phi-3.5-mini');
  });

  it('overwrites existing adapter with same id', async () => {
    const blob = new ArrayBuffer(4);
    await saveAdapter(META, blob);
    await saveAdapter({ ...META, name: 'Updated' }, blob);
    const adapters = await listAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.name).toBe('Updated');
  });
});

describe('deleteAdapter', () => {
  it('removes adapter from list', async () => {
    await saveAdapter(META, new ArrayBuffer(4));
    await deleteAdapter('lora-1');
    const result = await listAdapters();
    expect(result).toHaveLength(0);
  });

  it('does not throw when deleting non-existent id', async () => {
    await expect(deleteAdapter('nonexistent')).resolves.toBeUndefined();
  });
});

describe('getAdapterBlob', () => {
  it('returns null when adapter not found', async () => {
    const blob = await getAdapterBlob('missing');
    expect(blob).toBeNull();
  });

  it('returns the stored ArrayBuffer after save', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await saveAdapter(META, buffer);
    const result = await getAdapterBlob('lora-1');
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(4);
  });
});

describe('_resetLoraDbForTest — stale in-flight open ownership', () => {
  // QNBS-v3: proves a pending open from before _resetLoraDbForTest() runs cannot publish its (now-discarded-factory) connection once that helper has already cleared state.
  it('discards a stale open that completes only after _resetLoraDbForTest() already reset state', async () => {
    // QNBS-v3: clean slate — a database/openPromise cached by an earlier test in this file would otherwise short-circuit openDb() before it ever calls the mocked indexedDB.open() below.
    _resetLoraDbForTest();
    // QNBS-v3: a mutable object wrapper (not a reassigned `let`) avoids a tsgo control-flow narrowing artifact across the mock callback boundary.
    const stale: { fireSuccess: (() => void) | null } = { fireSuccess: null };
    const closeSpy = vi.fn();
    const staleDb = { close: closeSpy } as unknown as IDBDatabase;
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      const req = {} as IDBOpenDBRequest;
      Object.defineProperty(req, 'result', { value: staleDb, configurable: true });
      // QNBS-v3: onsuccess reads e.target.result — a plain `new Event(...)` has no target, so the event must be a stand-in object with target set to req.
      stale.fireSuccess = () => req.onsuccess?.({ target: req } as unknown as Event);
      return req;
    });

    const stalePromise = saveAdapter(META, new ArrayBuffer(0));
    const rejectionCheck = expect(stalePromise).rejects.toThrow();

    // The exact race: reset-for-test runs WHILE the open above is still pending (its onsuccess has not fired yet).
    _resetLoraDbForTest();
    openSpy.mockRestore();

    // Now let the OLD (stale) open complete, late.
    stale.fireSuccess?.();
    await rejectionCheck;

    expect(closeSpy).toHaveBeenCalledTimes(1);

    // A fresh call after the stale completion must retry and durably succeed against the new factory.
    await saveAdapter(META, new ArrayBuffer(4));
    const result = await listAdapters();
    expect(result).toHaveLength(1);
  });
});

describe('reset closer invalidates the pending flight (real beginIdbReset)', () => {
  afterEach(() => {
    _resetIdbResetGateForTest();
  });

  // QNBS-v3: the root-cause scenario the closer fix exists for — a reset overlapping a pending open must let the very next caller start a genuinely fresh flight immediately, not wait on the pending one's eventual generation-mismatch rejection.
  it('lets an immediate post-reset operation start a fresh flight, while the pre-reset open is discarded harmlessly when it completes late', async () => {
    _resetLoraDbForTest();

    const stale: { fireSuccess: (() => void) | null } = { fireSuccess: null };
    const closeSpy = vi.fn();
    const staleDb = { close: closeSpy } as unknown as IDBDatabase;
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      const req = {} as IDBOpenDBRequest;
      Object.defineProperty(req, 'result', { value: staleDb, configurable: true });
      stale.fireSuccess = () => req.onsuccess?.({ target: req } as unknown as Event);
      return req;
    });

    // Operation A starts — captures the IDB open synchronously, still pending (onsuccess not yet fired).
    const staleWrite = saveAdapter(META, new ArrayBuffer(0));
    const staleRejection = expect(staleWrite).rejects.toThrow();

    // A real reset overlaps the pending open — its closer must invalidate the pending flight, not just the (still-null) cached database.
    await beginIdbReset();
    endIdbReset();
    openSpy.mockRestore();

    // The first legitimate post-reset operation (B) must start a genuinely NEW flight immediately —
    // it must not be handed A's stale, still-pending promise and forced to wait on its rejection.
    await saveAdapter(META, new ArrayBuffer(4));
    const afterImmediateRetry = await listAdapters();
    expect(afterImmediateRetry).toHaveLength(1);

    // A's late completion must discard itself (closing the stale db) without disturbing B's state.
    stale.fireSuccess?.();
    await staleRejection;
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const afterStaleCompletion = await listAdapters();
    expect(afterStaleCompletion).toHaveLength(1);
  });
});
