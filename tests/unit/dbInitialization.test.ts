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

    it('removes exact owned legacy markers while preserving unknown same-origin keys', async () => {
      localStorage.setItem('worldscript_version', '1');
      localStorage.setItem('plotBoard_zoom', '1.5');
      localStorage.setItem('unrelated_key', 'keep');
      localStorage.setItem('worldscript-foreign-tool:key', 'keep-worldscript');
      localStorage.setItem('plotBoard_foreign:key', 'keep-plotboard');
      localStorage.setItem('schemaVersion_foreign:key', 'keep-schema');
      // QNBS-v3: dbConstants defines this as an IndexedDB record key; its spelling alone is not localStorage ownership proof.
      localStorage.setItem('__legacy_worldscript_db_migrated__', 'keep-unproven');
      const { resetAllDatabases } = await import('../../services/dbInitialization');

      await resetAllDatabases();

      expect(localStorage.getItem('worldscript_version')).toBeNull();
      expect(localStorage.getItem('plotBoard_zoom')).toBeNull();
      expect(localStorage.getItem('unrelated_key')).toBe('keep');
      expect(localStorage.getItem('worldscript-foreign-tool:key')).toBe('keep-worldscript');
      expect(localStorage.getItem('plotBoard_foreign:key')).toBe('keep-plotboard');
      expect(localStorage.getItem('schemaVersion_foreign:key')).toBe('keep-schema');
      expect(localStorage.getItem('__legacy_worldscript_db_migrated__')).toBe('keep-unproven');
    });

    it('fails closed when deleteDatabase fires onerror instead of onsuccess', async () => {
      mockDeleteDatabase.mockImplementation(() => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
        Promise.resolve().then(() => {
          if (typeof req['onerror'] === 'function') (req['onerror'] as () => void)();
        });
        return req;
      });

      const { resetAllDatabases } = await import('../../services/dbInitialization');
      await expect(resetAllDatabases()).rejects.toMatchObject({
        name: 'StartupDatabaseResetError',
        dataMayHaveBeenRemoved: false,
      });
    });

    it('waits for a blocked request to reach onsuccess before reporting a completed reset', async () => {
      mockDeleteDatabase.mockImplementation(() => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
        // QNBS-v3: two microtask turns model onblocked as a nonterminal notification followed by the request's real success event.
        Promise.resolve().then(() => {
          if (typeof req['onblocked'] === 'function') (req['onblocked'] as () => void)();
          Promise.resolve().then(() => {
            if (typeof req['onsuccess'] === 'function') (req['onsuccess'] as () => void)();
          });
        });
        return req;
      });

      const { resetAllDatabases } = await import('../../services/dbInitialization');

      await expect(resetAllDatabases()).resolves.toBeUndefined();
      expect(mockDeleteDatabase).toHaveBeenCalledTimes(2);
    });

    it('marks a reset partial when blocked delete requests time out but could still complete', async () => {
      vi.useFakeTimers();
      mockDeleteDatabase.mockImplementation(() => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
        Promise.resolve().then(() => {
          if (typeof req['onblocked'] === 'function') (req['onblocked'] as () => void)();
        });
        return req;
      });

      try {
        const { resetAllDatabases } = await import('../../services/dbInitialization');
        const reset = resetAllDatabases();
        void reset.catch(() => undefined);
        await vi.runAllTimersAsync();

        await expect(reset).rejects.toMatchObject({
          name: 'StartupDatabaseResetError',
          outcome: 'partial-reset',
          dataMayHaveBeenRemoved: true,
        });
        await expect(resetAllDatabases()).rejects.toMatchObject({ outcome: 'partial-reset' });
        expect(mockDeleteDatabase).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks partial reset when one database is deleted and the other fails', async () => {
      mockDeleteDatabase.mockImplementation((name: string) => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null };
        Promise.resolve().then(() => {
          const handler = name === 'worldscript-state-db' ? req['onsuccess'] : req['onerror'];
          if (typeof handler === 'function') (handler as () => void)();
        });
        return req;
      });

      const { resetAllDatabases, StartupDatabaseResetError } = await import(
        '../../services/dbInitialization'
      );

      await expect(resetAllDatabases()).rejects.toMatchObject({
        name: StartupDatabaseResetError.name,
        outcome: 'partial-reset',
        dataMayHaveBeenRemoved: true,
      });
      await expect(resetAllDatabases()).rejects.toMatchObject({ outcome: 'partial-reset' });
      expect(mockDeleteDatabase).toHaveBeenCalledTimes(2);
    });

    it('fails before database deletion when localStorage is unavailable', async () => {
      vi.stubGlobal('localStorage', undefined);
      const { resetAllDatabases } = await import('../../services/dbInitialization');

      await expect(resetAllDatabases()).rejects.toMatchObject({
        name: 'StartupDatabaseResetError',
        outcome: 'failed-before-primary-delete',
        dataMayHaveBeenRemoved: false,
      });
      expect(mockDeleteDatabase).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
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
