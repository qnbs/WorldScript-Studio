/**
 * Tests for services/factoryResetService.ts
 * QNBS-v3: wipeAllAppData — clears IDB + web storage + SW caches, then reloads. Covers the
 * native indexedDB.databases() path, the known-list fallback, and the Cache API branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAllAppData } from '../../services/factoryResetService';
import { logger } from '../../services/logger';

const { mockIsTauriRuntime, mockDeleteAllFsData } = vi.hoisted(() => ({
  mockIsTauriRuntime: vi.fn(() => false),
  mockDeleteAllFsData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));

vi.mock('../../services/fs/fsEncryptionMigration', () => ({
  deleteAllFsData: () => mockDeleteAllFsData(),
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
  mockDeleteAllFsData.mockResolvedValue(undefined);
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

  it('does not touch filesystem data outside the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(false);

    await runWipe();

    expect(mockDeleteAllFsData).not.toHaveBeenCalled();
  });

  it('deletes filesystem data BEFORE clearing IDB/web storage, in the Tauri runtime', async () => {
    await createDb('worldscript-data-db');
    mockIsTauriRuntime.mockReturnValue(true);
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    await runWipe();

    expect(mockDeleteAllFsData).toHaveBeenCalled();
    expect(delSpy).toHaveBeenCalled();
    const fsDataCallOrder = mockDeleteAllFsData.mock.invocationCallOrder[0] as number;
    const idbDeleteCallOrder = delSpy.mock.invocationCallOrder[0] as number;
    expect(fsDataCallOrder).toBeLessThan(idbDeleteCallOrder);
    delSpy.mockRestore();
  });

  it('aborts before deleting any IDB database or clearing storage when filesystem cleanup fails, in the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockDeleteAllFsData.mockRejectedValueOnce(new Error('fs delete failed'));
    localStorage.setItem('foo', 'bar');
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase');

    // QNBS-v3: fs-delete rejects synchronously before the 300ms fake-timer delay is ever scheduled — plain await, no runWipe()/fake timers needed for this negative path.
    await expect(wipeAllAppData()).rejects.toThrow('fs delete failed');

    expect(delSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('foo')).toBe('bar');
    expect(reloadMock).not.toHaveBeenCalled();
    delSpy.mockRestore();
  });
});
