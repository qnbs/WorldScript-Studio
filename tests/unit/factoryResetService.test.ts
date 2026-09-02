/**
 * Tests for services/factoryResetService.ts
 * QNBS-v3: covers the native indexedDB.databases() path, the known-list fallback, the Cache API branch, and the Tauri AppData clear branch (exists/missing/partial-failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAllAppData } from '../../services/factoryResetService';
import { logger } from '../../services/logger';

const mockIsTauriRuntime = vi.fn(() => false);
const mockLoadTauriApis = vi.fn();
const mockCloseDbServiceConnections = vi.fn();
const mockCloseJournalStoreConnection = vi.fn();
const mockCloseSentinelStoreConnection = vi.fn();

vi.mock('../../services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));
vi.mock('../../services/fs/fsCore', () => ({
  loadTauriApis: (...args: unknown[]) => mockLoadTauriApis(...args),
  // QNBS-v3: pass-through — retry/backoff behavior is covered by fsCore.test.ts directly.
  retryFs: (fn: () => Promise<unknown>) => fn(),
}));
// QNBS-v3: #532 — deleteDatabase silently treated onblocked as success while this page's own
// connections stayed open; these three closes must run before deleteDatabase is ever called.
vi.mock('../../services/storage', () => ({
  closeDbServiceConnectionsForReset: () => mockCloseDbServiceConnections(),
}));
vi.mock('../../services/storage/encryptionMigrationJournal', () => ({
  closeJournalStoreConnectionForReset: () => mockCloseJournalStoreConnection(),
}));
vi.mock('../../services/storage/idbPassphraseSentinel', () => ({
  closeSentinelStoreConnectionForReset: () => mockCloseSentinelStoreConnection(),
}));

function createDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('s');
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// QNBS-v3: production has a real 300ms settle delay before reload — drive it with fake timers so
// the suite stays deterministic and fast (CodeAnt #132). runAllTimersAsync loops until every
// pending timer is drained, which also flushes the fake-indexeddb deletion scheduling.
async function runWipe(): Promise<void> {
  vi.useFakeTimers();
  try {
    const done = wipeAllAppData();
    await vi.runAllTimersAsync();
    await done;
  } finally {
    vi.useRealTimers();
  }
}

let reloadMock: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsTauriRuntime.mockReturnValue(false);
  reloadMock = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: reloadMock },
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
});

describe('wipeAllAppData', () => {
  it('clears web storage, deletes IDB databases, and reloads', async () => {
    await createDb('worldscript-data-db');
    localStorage.setItem('foo', 'bar');
    sessionStorage.setItem('baz', 'qux');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    expect(localStorage.getItem('foo')).toBeNull();
    expect(sessionStorage.getItem('baz')).toBeNull();
    expect(delSpy).toHaveBeenCalledWith('worldscript-data-db');
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    delSpy.mockRestore();
  });

  // QNBS-v3: #532 root cause — a still-open connection silently blocked deleteDatabase while the
  // code reported success anyway; closing known connections first must happen before any delete.
  it("closes this page's own known IDB connections before deleting any database", async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    expect(mockCloseDbServiceConnections).toHaveBeenCalledTimes(1);
    expect(mockCloseJournalStoreConnection).toHaveBeenCalledTimes(1);
    expect(mockCloseSentinelStoreConnection).toHaveBeenCalledTimes(1);
    const dbCloseOrder = mockCloseDbServiceConnections.mock.invocationCallOrder[0];
    const journalCloseOrder = mockCloseJournalStoreConnection.mock.invocationCallOrder[0];
    const sentinelCloseOrder = mockCloseSentinelStoreConnection.mock.invocationCallOrder[0];
    const firstDeleteOrder = delSpy.mock.invocationCallOrder[0];
    expect(dbCloseOrder).toBeDefined();
    expect(journalCloseOrder).toBeDefined();
    expect(sentinelCloseOrder).toBeDefined();
    expect(firstDeleteOrder).toBeDefined();
    // QNBS-v3: all three closes must precede the first delete, not just one — any left open can silently reintroduce the block.
    expect(dbCloseOrder as number).toBeLessThan(firstDeleteOrder as number);
    expect(journalCloseOrder as number).toBeLessThan(firstDeleteOrder as number);
    expect(sentinelCloseOrder as number).toBeLessThan(firstDeleteOrder as number);
    delSpy.mockRestore();
  });

  // QNBS-v3: onblocked must reject, not resolve, or the reset reports a false "fresh install" success while the database still has old data.
  it('rejects and never reloads when a database deletion is blocked by another open connection', async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((_name: string) => {
      const req = {} as IDBOpenDBRequest;
      queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return req;
    });

    vi.useFakeTimers();
    try {
      await expect(wipeAllAppData()).rejects.toThrow(/blocked by another open connection/);
    } finally {
      vi.useRealTimers();
    }

    expect(reloadMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`deleteDatabase(worldscript-data-db) blocked`),
    );
    delSpy.mockRestore();
  });

  it('falls back to the known database list when indexedDB.databases() fails', async () => {
    const dbSpy = vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new Error('not allowed'));
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    // Fallback deletes every name in the known list (e.g. the logs DB).
    expect(delSpy).toHaveBeenCalledWith('worldscript-logs-db');
    expect(reloadMock).toHaveBeenCalledTimes(1);
    dbSpy.mockRestore();
    delSpy.mockRestore();
  });

  it("clears this app's own service-worker caches when the Cache API is available", async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi
        .fn()
        .mockResolvedValue(['worldscript-static-v1.28.2', 'worldscript-dynamic-v1.28.2']),
      delete: del,
    });

    await runWipe();

    expect(del).toHaveBeenCalledWith('worldscript-static-v1.28.2');
    expect(del).toHaveBeenCalledWith('worldscript-dynamic-v1.28.2');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: a shared origin can host caches from an unrelated app/tool — factory reset must never delete them.
  it('never deletes a foreign, non-owned cache on the shared origin', async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi
        .fn()
        .mockResolvedValue(['worldscript-static-v1.28.2', 'some-other-tools-analytics-cache']),
      delete: del,
    });

    await runWipe();

    expect(del).toHaveBeenCalledWith('worldscript-static-v1.28.2');
    expect(del).not.toHaveBeenCalledWith('some-other-tools-analytics-cache');
    expect(del).toHaveBeenCalledTimes(1);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  describe('desktop (Tauri) AppData clearing', () => {
    beforeEach(() => {
      mockIsTauriRuntime.mockReturnValue(true);
    });

    it('skips readDir/remove when the AppData path does not exist, and still completes the wipe', async () => {
      const removeMock = vi.fn().mockResolvedValue(undefined);
      mockLoadTauriApis.mockResolvedValue({
        appDataDir: vi.fn().mockResolvedValue('/app/data'),
        exists: vi.fn().mockResolvedValue(false),
        readDir: vi.fn(),
        join: vi.fn(),
        remove: removeMock,
      });

      await runWipe();

      expect(removeMock).not.toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('removes every AppData entry (skipping unnamed entries) and completes the wipe', async () => {
      const removeMock = vi.fn().mockResolvedValue(undefined);
      const joinMock = vi.fn((base: string, name: string) => Promise.resolve(`${base}/${name}`));
      mockLoadTauriApis.mockResolvedValue({
        appDataDir: vi.fn().mockResolvedValue('/app/data'),
        exists: vi.fn().mockResolvedValue(true),
        readDir: vi
          .fn()
          .mockResolvedValue([{ name: 'projects' }, { name: undefined }, { name: 'keys.bin' }]),
        join: joinMock,
        remove: removeMock,
      });

      await runWipe();

      expect(removeMock).toHaveBeenCalledWith('/app/data/projects', { recursive: true });
      expect(removeMock).toHaveBeenCalledWith('/app/data/keys.bin', { recursive: true });
      expect(removeMock).toHaveBeenCalledTimes(2);
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('rejects and never reloads when every AppData entry fails to remove', async () => {
      mockLoadTauriApis.mockResolvedValue({
        appDataDir: vi.fn().mockResolvedValue('/app/data'),
        exists: vi.fn().mockResolvedValue(true),
        readDir: vi.fn().mockResolvedValue([{ name: 'locked-file' }]),
        join: vi.fn((base: string, name: string) => Promise.resolve(`${base}/${name}`)),
        remove: vi.fn().mockRejectedValue(new Error('EBUSY')),
      });

      vi.useFakeTimers();
      try {
        await expect(wipeAllAppData()).rejects.toThrow(
          'Factory reset could not clear desktop data',
        );
      } finally {
        vi.useRealTimers();
      }

      expect(reloadMock).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to clear Tauri app data during factory reset:',
        expect.any(Error),
      );
    });

    it('rejects and never reloads when readDir itself throws', async () => {
      mockLoadTauriApis.mockResolvedValue({
        appDataDir: vi.fn().mockResolvedValue('/app/data'),
        exists: vi.fn().mockResolvedValue(true),
        readDir: vi.fn().mockRejectedValue(new Error('permission denied')),
        join: vi.fn(),
        remove: vi.fn(),
      });

      vi.useFakeTimers();
      try {
        await expect(wipeAllAppData()).rejects.toThrow(
          'Factory reset could not clear desktop data',
        );
      } finally {
        vi.useRealTimers();
      }

      expect(reloadMock).not.toHaveBeenCalled();
    });
  });
});
