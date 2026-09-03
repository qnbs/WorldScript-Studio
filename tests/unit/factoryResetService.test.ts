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
