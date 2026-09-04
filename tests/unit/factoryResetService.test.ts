/**
 * Tests for services/factoryResetService.ts
 * QNBS-v3: covers the native indexedDB.databases() path, the known-list fallback, the Cache API branch, and the Tauri AppData clear branch (exists/missing/partial-failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crossProjectIndexCoordinator,
  duckDbWriteCoordinator,
  projectPersistenceCoordinator,
} from '../../app/persistenceCoordinator';
import { isFactoryResetInProgress, wipeAllAppData } from '../../services/factoryResetService';
import { logger } from '../../services/logger';

const mockIsTauriRuntime = vi.fn(() => false);
const mockLoadTauriApis = vi.fn();
const mockBeginIdbReset = vi.fn();
const mockEndIdbReset = vi.fn();

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
// QNBS-v3: the gate's own registry/generation behavior is covered directly by idbResetGate.test.ts — this suite only verifies factoryResetService calls begin/end at the right points.
vi.mock('../../services/storage/idbResetGate', () => ({
  beginIdbReset: () => mockBeginIdbReset(),
  endIdbReset: () => mockEndIdbReset(),
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

  // QNBS-v3: guards flushPersistedState's visibilitychange/quit-flush call sites against racing this same reload and recreating a just-deleted database with stale state.
  it('marks a reset in progress for the duration of a successful wipe', async () => {
    await runWipe();
    expect(isFactoryResetInProgress()).toBe(true);
  });

  // QNBS-v3: a save already enqueued before resetInProgress flips has already passed its own guard check and will run regardless -- proves the reset waits for it to finish before deleting anything, instead of racing it.
  it('drains a project save already enqueued before deleting any database', async () => {
    await createDb('worldscript-data-db');
    let resolveSave: () => void = () => {};
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const enqueued = projectPersistenceCoordinator.enqueue(() => pendingSave);

    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');
    vi.useFakeTimers();
    try {
      const done = wipeAllAppData();
      // QNBS-v3: lets the idle()-await point run without letting the still-pending save resolve.
      await Promise.resolve();
      await Promise.resolve();
      expect(delSpy).not.toHaveBeenCalled();

      resolveSave();
      await enqueued;
      await vi.runAllTimersAsync();
      await done;
      expect(delSpy).toHaveBeenCalled();
    } finally {
      // QNBS-v3: resolveSave() is idempotent (a no-op if the success path already called it) -- an assertion failing above must not leave this singleton coordinator permanently stuck, hanging every later test's own wipeAllAppData() at idle().
      resolveSave();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      delSpy.mockRestore();
    }
  });

  // QNBS-v3: the post-save index/DuckDB writes were previously untracked by any drain, so a reset could delete the database they were about to write to. Two separate coordinators (not one shared instance) since a shared single queue slot let one resource's write silently discard the other's.
  it('drains both the cross-project-index and DuckDB write coordinators before deleting any database', async () => {
    await createDb('worldscript-data-db');
    let resolveIndexWrite: () => void = () => {};
    let resolveDuckDbWrite: () => void = () => {};
    const pendingIndexWrite = new Promise<void>((resolve) => {
      resolveIndexWrite = resolve;
    });
    const pendingDuckDbWrite = new Promise<void>((resolve) => {
      resolveDuckDbWrite = resolve;
    });
    const enqueuedIndex = crossProjectIndexCoordinator.enqueue(() => pendingIndexWrite);
    const enqueuedDuckDb = duckDbWriteCoordinator.enqueue(() => pendingDuckDbWrite);

    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');
    vi.useFakeTimers();
    try {
      const done = wipeAllAppData();
      // QNBS-v3: lets the idle()-await point run without letting either still-pending write resolve.
      await Promise.resolve();
      await Promise.resolve();
      expect(delSpy).not.toHaveBeenCalled();

      // QNBS-v3: DuckDB resolved first (not index) is the discriminating order -- if crossProjectIndexCoordinator.idle() were dropped from the drain, deletion would proceed right here since every other awaited promise is already settled.
      resolveDuckDbWrite();
      await enqueuedDuckDb;
      await Promise.resolve();
      await Promise.resolve();
      expect(delSpy).not.toHaveBeenCalled();

      resolveIndexWrite();
      await enqueuedIndex;
      await vi.runAllTimersAsync();
      await done;
      expect(delSpy).toHaveBeenCalled();
    } finally {
      // QNBS-v3: idempotent no-op if the success path already resolved it -- see the project-save drain test above for why this matters.
      resolveIndexWrite();
      resolveDuckDbWrite();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      delSpy.mockRestore();
    }
  });

  // QNBS-v3: a bare reload preserves the hash, and readInitialView() reads it before checking whether a project exists, rebooting a freshly wiped app straight back into the pre-reset view.
  it('sanitizes the view-carrying hash and view query param before reload, preserving other URL state', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'http://localhost:3000/WorldScript-Studio/?foo=bar&view=settings#/settings',
        reload: reloadMock,
      },
    });
    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => undefined);

    await runWipe();

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/WorldScript-Studio/?foo=bar');
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      reloadMock.mock.invocationCallOrder[0]!,
    );
    replaceStateSpy.mockRestore();
  });

  // QNBS-v3: URLSearchParams.delete() + toString() would reserialize every retained parameter, silently turning a raw %20 into + or a bare flag into an explicit empty value -- proves the fix strips only `view` at the string level.
  it('removes only the view query param without reserializing non-canonical unrelated query encoding', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'http://localhost:3000/WorldScript-Studio/?foo=a%20b&flag&view=settings',
        reload: reloadMock,
      },
    });
    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => undefined);

    await runWipe();

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/WorldScript-Studio/?foo=a%20b&flag');
    replaceStateSpy.mockRestore();
  });

  // QNBS-v3: readInitialView() reads via URLSearchParams.get('view'), which decodes -- an encoded spelling like %76iew would otherwise survive a raw-key comparison and still restore Settings after reload.
  it('strips a percent-encoded view key, not just the literal spelling', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'http://localhost:3000/WorldScript-Studio/?%76iew=settings&foo=bar',
        reload: reloadMock,
      },
    });
    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => undefined);

    await runWipe();

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/WorldScript-Studio/?foo=bar');
    replaceStateSpy.mockRestore();
  });

  // QNBS-v3: a still-open connection silently blocked deleteDatabase while the code reported success anyway; the reset gate must begin (closing every registered connection) before any delete.
  it('begins the reset gate before deleting any database', async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    expect(mockBeginIdbReset).toHaveBeenCalledTimes(1);
    const beginOrder = mockBeginIdbReset.mock.invocationCallOrder[0];
    const firstDeleteOrder = delSpy.mock.invocationCallOrder[0];
    expect(beginOrder).toBeDefined();
    expect(firstDeleteOrder).toBeDefined();
    expect(beginOrder as number).toBeLessThan(firstDeleteOrder as number);
    expect(mockEndIdbReset).not.toHaveBeenCalled();
    delSpy.mockRestore();
  });

  // QNBS-v3 (cubic/coderabbit): onblocked alone must not settle the promise -- only a block that genuinely outlasts the timeout is treated as a failure.
  it('rejects, never reloads, and releases the reset gate when a database deletion stays blocked past the timeout', async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((_name: string) => {
      const req = {} as IDBOpenDBRequest;
      queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return req;
    });

    vi.useFakeTimers();
    try {
      const wiped = wipeAllAppData();
      // QNBS-v3: attached synchronously, in the same tick the promise is created — a handler attached only after runAllTimersAsync() lets the timeout-driven rejection fire unhandled for a full turn first, which Node flags even once it's later caught.
      void wiped.catch(() => undefined);
      await vi.runAllTimersAsync();
      await expect(wiped).rejects.toThrow(/still blocked after/);
    } finally {
      vi.useRealTimers();
    }

    expect(reloadMock).not.toHaveBeenCalled();
    expect(mockBeginIdbReset).toHaveBeenCalledTimes(1);
    expect(mockEndIdbReset).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`deleteDatabase(worldscript-data-db) blocked`),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`deleteDatabase(worldscript-data-db) still blocked after`),
    );
    delSpy.mockRestore();
  });

  // QNBS-v3 (cubic/coderabbit): the regression case the fix exists for -- a block that clears before the timeout must resolve normally, not be treated as a failure.
  it('resolves once a blocked deletion is followed by a real onsuccess, without waiting for the timeout', async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((_name: string) => {
      const req = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent);
        queueMicrotask(() => req.onsuccess?.(new Event('success') as unknown as Event));
      });
      return req;
    });

    vi.useFakeTimers();
    try {
      const wiped = wipeAllAppData();
      await vi.runAllTimersAsync();
      await wiped;
    } finally {
      vi.useRealTimers();
    }

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(mockEndIdbReset).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`deleteDatabase(worldscript-data-db) blocked`),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('still blocked after'));
    delSpy.mockRestore();
  });

  // QNBS-v3: proves allSettled semantics — a fast rejection must not release the gate while another deletion is still outstanding; the gate only releases once every deletion has settled.
  it('waits for every database deletion to settle before releasing the gate, even when one rejects quickly and another is deliberately delayed', async () => {
    const dbSpy = vi.spyOn(indexedDB, 'databases').mockResolvedValue([
      { name: 'worldscript-data-db', version: 1 },
      { name: 'worldscript-logs-db', version: 1 },
    ]);
    // QNBS-v3: a mutable object wrapper (not a reassigned `let`) avoids a tsgo control-flow narrowing artifact across the mock callback boundary.
    const slow: { resolve: (() => void) | null } = { resolve: null };
    const calledNames: string[] = [];
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name: string) => {
      calledNames.push(name);
      const req = {} as IDBOpenDBRequest;
      if (name === 'worldscript-data-db') {
        queueMicrotask(() => req.onerror?.(new Event('error')));
      } else {
        slow.resolve = () => req.onsuccess?.(new Event('success'));
      }
      return req;
    });

    let settled = false;
    const wipePromise = wipeAllAppData();
    void wipePromise.catch(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(calledNames).toEqual(
        expect.arrayContaining(['worldscript-data-db', 'worldscript-logs-db']),
      );
    });
    // QNBS-v3: the fast rejection has already fired by now, but the slow deletion hasn't settled — the gate must not release yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockEndIdbReset).not.toHaveBeenCalled();

    slow.resolve?.();
    await expect(wipePromise).rejects.toThrow(/database deletion\(s\) failed/);

    expect(mockEndIdbReset).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
    dbSpy.mockRestore();
    delSpy.mockRestore();
  });

  // QNBS-v3: the fail-closed contract's core proof — a closer failure must abort the wipe entirely, before any database deletion is attempted, while still releasing the gate for retry.
  it('never deletes any database and releases the gate when beginIdbReset itself rejects', async () => {
    await createDb('worldscript-data-db');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');
    mockBeginIdbReset.mockRejectedValueOnce(
      new Error('[idbResetGate] reset teardown incomplete — 1 closer(s) failed: close failed'),
    );

    await expect(wipeAllAppData()).rejects.toThrow(/closer\(s\) failed/);

    expect(delSpy).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(mockEndIdbReset).toHaveBeenCalledTimes(1);
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

  // QNBS-v3: hard preserve-first gate — a shared origin can host a database from an unrelated app/tool; indexedDB.databases() enumerates the whole origin, so factory reset must never construct a deletion target from anything it doesn't own.
  it('never deletes a foreign, non-owned database on the shared origin, including when native enumeration succeeds', async () => {
    const dbSpy = vi.spyOn(indexedDB, 'databases').mockResolvedValue([
      { name: 'worldscript-data-db', version: 1 },
      { name: 'worldscript-localfirst-proj-123', version: 1 },
      { name: 'some-other-tools-database', version: 1 },
    ]);
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    expect(delSpy).toHaveBeenCalledWith('worldscript-data-db');
    expect(delSpy).toHaveBeenCalledWith('worldscript-localfirst-proj-123');
    expect(delSpy).not.toHaveBeenCalledWith('some-other-tools-database');
    expect(delSpy).toHaveBeenCalledTimes(2);
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
      // QNBS-v3: a failed reset never reloads, so the app keeps running -- the flag must not stay stuck on and silently block every future save.
      expect(isFactoryResetInProgress()).toBe(false);
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
