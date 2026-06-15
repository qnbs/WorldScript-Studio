/**
 * Centralised storage bootstrap — extracted from the index.tsx IIFE so it
 * can be called from tests and the StorageErrorScreen recovery flow.
 */
import { DATA_DB_NAME, STATE_DB_NAME } from './dbConstants';
import { dbService } from './dbService';
import { logger } from './logger';

export interface InitStorageResult {
  success: boolean;
  /** Whether a legacy worldscript-db migration was performed. */
  migrated: boolean;
  /** Human-readable error message when success === false. */
  error?: string;
}

function formatStorageError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError')
      return 'Browser storage is full. Please delete old projects or free up disk space.';
    if (err.name === 'InvalidStateError' || err.name === 'TransactionInactiveError')
      return 'Database is in an invalid state. Please reload the page.';
    if (err.name === 'AbortError') return 'Database open was aborted.';
    if (err.name === 'VersionError')
      return 'Database schema mismatch. Try clearing site data in browser settings.';
  }
  if (err instanceof Error) return err.message;
  return 'Unknown storage error.';
}

function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve) => {
    // QNBS-v3: resolve on both success and error so one DB failure doesn't block the other.
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => {
      logger.warn(`dbInitialization: could not delete "${name}":`, req.error);
      resolve();
    };
    req.onblocked = () => {
      logger.warn(`dbInitialization: deleteDatabase "${name}" blocked (other tab open?)`);
      resolve();
    };
  });
}

/**
 * Initialises both IndexedDB databases and runs the legacy migration if needed.
 * Returns a typed result instead of throwing so callers can present a recovery UI.
 */
export async function initializeStorage(): Promise<InitStorageResult> {
  try {
    await dbService.initDB();
    return { success: true, migrated: false };
  } catch (err) {
    logger.error('dbInitialization: initializeStorage failed', err);
    return { success: false, migrated: false, error: formatStorageError(err) };
  }
}

/**
 * Checks available browser storage quota and returns a health status.
 * Warns when usage exceeds 85 % of quota — gives users time to act before
 * QuotaExceededError aborts saves.
 */
export interface StorageHealth {
  ok: boolean;
  usagePercent: number | null;
  usageMb: number | null;
  quotaMb: number | null;
  warning?: string;
}

export async function checkStorageHealth(): Promise<StorageHealth> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || estimate.quota == null) {
      return { ok: true, usagePercent: null, usageMb: null, quotaMb: null };
    }
    const quotaMb = Math.round(estimate.quota / 1_048_576);
    const usageMb = estimate.usage != null ? Math.round(estimate.usage / 1_048_576) : null;
    const usagePercent =
      usageMb != null && quotaMb > 0 ? Math.round((usageMb / quotaMb) * 100) : null;

    if (usagePercent != null && usagePercent >= 85) {
      return {
        ok: false,
        usagePercent,
        usageMb,
        quotaMb,
        warning: `Storage ${usagePercent}% full (${usageMb}/${quotaMb} MB). Delete old projects or snapshots to avoid data loss.`,
      };
    }
    return { ok: true, usagePercent, usageMb, quotaMb };
  } catch {
    return { ok: true, usagePercent: null, usageMb: null, quotaMb: null };
  }
}

/**
 * Deletes both IndexedDB databases and relevant localStorage markers.
 * Use as a last-resort recovery option (user-confirmed).
 */
export async function resetAllDatabases(): Promise<void> {
  logger.warn('dbInitialization: resetAllDatabases — deleting both IDB databases');
  await Promise.all([deleteIdb(STATE_DB_NAME), deleteIdb(DATA_DB_NAME)]);

  // Remove localStorage markers that guard migration idempotency + any plotBoard viewport state.
  // QNBS-v3: Only worldscript-specific keys; avoids wiping unrelated site storage.
  const prefix = ['worldscript', 'plotBoard', 'schemaVersion', '__legacy_worldscript'];
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && prefix.some((p) => key.startsWith(p))) {
      localStorage.removeItem(key);
    }
  }

  logger.info('dbInitialization: resetAllDatabases — complete');
}
