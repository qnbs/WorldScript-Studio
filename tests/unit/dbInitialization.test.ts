// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-configurable indexedDB, letting us freely stub it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInitDB, mockDeleteDatabase } = vi.hoisted(() => ({
  mockInitDB: vi.fn(),
  mockDeleteDatabase: vi.fn(),
}));

vi.mock('../../services/dbService', () => ({
  dbService: { initDB: mockInitDB },
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/dbConstants', () => ({
  STATE_DB_NAME: 'worldscript-state-db',
  DATA_DB_NAME: 'worldscript-data-db',
}));

describe('dbInitialization', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInitDB.mockReset();
    mockDeleteDatabase.mockReset();

    // QNBS-v3: fresh req per call so parallel deletes each own their onsuccess slot.
    mockDeleteDatabase.mockImplementation(() => {
      const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
      Promise.resolve().then(() => {
        if (typeof req['onsuccess'] === 'function') (req['onsuccess'] as () => void)();
      });
      return req;
    });

    // QNBS-v3: writable:true from setup.ts so assignment works; configurable:false so no delete.
    (window as unknown as Record<string, unknown>)['indexedDB'] = {
      deleteDatabase: mockDeleteDatabase,
    };
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('initializeStorage', () => {
    it('returns success when initDB resolves', async () => {
      mockInitDB.mockResolvedValue(undefined);
      const { initializeStorage } = await import('../../services/dbInitialization');

      const result = await initializeStorage();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns failure with human-readable message on QuotaExceededError', async () => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      mockInitDB.mockRejectedValue(err);
      const { initializeStorage } = await import('../../services/dbInitialization');

      const result = await initializeStorage();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/storage is full/i);
    });

    it('returns failure on InvalidStateError', async () => {
      const err = new DOMException('invalid state', 'InvalidStateError');
      mockInitDB.mockRejectedValue(err);
      const { initializeStorage } = await import('../../services/dbInitialization');

      const result = await initializeStorage();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns failure with error.message for generic Error', async () => {
      mockInitDB.mockRejectedValue(new Error('disk full'));
      const { initializeStorage } = await import('../../services/dbInitialization');

      const result = await initializeStorage();

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
    });

    it('returns a fallback string for non-Error throws', async () => {
      mockInitDB.mockRejectedValue('string-error');
      const { initializeStorage } = await import('../../services/dbInitialization');

      const result = await initializeStorage();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('resetAllDatabases', () => {
    it('deletes both IDB databases', async () => {
      const { resetAllDatabases } = await import('../../services/dbInitialization');

      await resetAllDatabases();

      const deletedNames = mockDeleteDatabase.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(deletedNames).toContain('worldscript-state-db');
      expect(deletedNames).toContain('worldscript-data-db');
    });

    it('removes worldscript-prefixed localStorage keys', async () => {
      localStorage.setItem('worldscript_version', '1');
      localStorage.setItem('plotBoard_zoom', '1.5');
      localStorage.setItem('unrelated_key', 'keep');
      const { resetAllDatabases } = await import('../../services/dbInitialization');

      await resetAllDatabases();

      expect(localStorage.getItem('worldscript_version')).toBeNull();
      expect(localStorage.getItem('plotBoard_zoom')).toBeNull();
      expect(localStorage.getItem('unrelated_key')).toBe('keep');
    });

    it('resolves even when deleteDatabase fires onerror instead of onsuccess', async () => {
      mockDeleteDatabase.mockImplementation(() => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
        Promise.resolve().then(() => {
          if (typeof req['onerror'] === 'function') (req['onerror'] as () => void)();
        });
        return req;
      });

      const { resetAllDatabases } = await import('../../services/dbInitialization');
      await expect(resetAllDatabases()).resolves.toBeUndefined();
    });
  });
});

// ─── Storage Health Check ─────────────────────────────────────────────────────
describe('checkStorageHealth', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.stubGlobal('navigator', {
      ...originalNavigator,
      storage: { estimate: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok when storage.estimate is unavailable', async () => {
    vi.stubGlobal('navigator', { ...originalNavigator, storage: undefined });
    const { checkStorageHealth } = await import('../../services/dbInitialization');
    const result = await checkStorageHealth();
    expect(result.ok).toBe(true);
    expect(result.usagePercent).toBeNull();
  });

  it('returns ok when usage is below 85%', async () => {
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue({
      usage: 50 * 1_048_576,
      quota: 100 * 1_048_576,
    });
    const { checkStorageHealth } = await import('../../services/dbInitialization');
    const result = await checkStorageHealth();
    expect(result.ok).toBe(true);
    expect(result.usagePercent).toBe(50);
    expect(result.usageMb).toBe(50);
    expect(result.quotaMb).toBe(100);
  });

  it('returns warning when usage is at or above 85%', async () => {
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockResolvedValue({
      usage: 90 * 1_048_576,
      quota: 100 * 1_048_576,
    });
    const { checkStorageHealth } = await import('../../services/dbInitialization');
    const result = await checkStorageHealth();
    expect(result.ok).toBe(false);
    expect(result.usagePercent).toBe(90);
    expect(result.warning).toMatch(/90% full/);
  });

  it('gracefully handles exceptions from storage.estimate', async () => {
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
    const { checkStorageHealth } = await import('../../services/dbInitialization');
    const result = await checkStorageHealth();
    expect(result.ok).toBe(true);
  });
});
