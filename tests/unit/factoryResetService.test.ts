/**
 * Tests for services/factoryResetService.ts
 * QNBS-v3: [data safety / verify complete reset sequencing / preserves deterministic recovery]. Covers the
 * native indexedDB.databases() path, the known-list fallback, the Cache API branch, and the
 * Tauri AppData clear branch (exists/missing/partial-failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAllAppData } from '../../services/factoryResetService';
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

  it('clears service-worker caches when the Cache API is available', async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['static-v1', 'dynamic-v1']),
      delete: del,
    });

    await runWipe();

    expect(del).toHaveBeenCalledWith('static-v1');
    expect(del).toHaveBeenCalledWith('dynamic-v1');
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
