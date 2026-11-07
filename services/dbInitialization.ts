/**
 * Centralised storage bootstrap — extracted from the index.tsx IIFE so it
 * can be called from tests and the StorageErrorScreen recovery flow.
 */
import { DATA_DB_NAME, STATE_DB_NAME } from './dbConstants';
import { dbService } from './dbService';
import { logger } from './logger';
import {
  assertAppOwnedLocalStorageAvailable,
  clearAppOwnedLegacyResetMarkersAfterPrimaryDataDeletion,
} from './storage/appOwnedWebStorage';
import { beginIdbReset, endIdbReset } from './storage/idbResetGate';

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

const RESET_DELETE_BLOCKED_TIMEOUT_MS = 3000;
let activeDatabaseReset: Promise<void> | null = null;
let partialDatabaseResetDetected = false;

type DatabaseResetOutcome = 'failed-before-primary-delete' | 'partial-reset';

export class StartupDatabaseResetError extends Error {
  readonly dataMayHaveBeenRemoved: boolean;

  constructor(readonly outcome: DatabaseResetOutcome) {
    super(
      outcome === 'partial-reset'
        ? 'Database reset stopped after deletion began. Restart the app before retrying.'
        : 'Database reset stopped before local project data deletion began.',
    );
    this.name = 'StartupDatabaseResetError';
    this.dataMayHaveBeenRemoved = outcome === 'partial-reset';
  }
}

function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    let blockedTimeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      if (blockedTimeout) clearTimeout(blockedTimeout);
      finish();
    };
    req.onsuccess = () => settle(resolve);
    req.onerror = () => {
      logger.warn('dbInitialization: an app-owned database could not be deleted', {
        databaseName: name,
        errorName: req.error?.name ?? 'unknown',
      });
      settle(() => reject(new Error('Database reset could not delete an app database')));
    };
    req.onblocked = () => {
      logger.warn(
        'dbInitialization: app-owned database deletion is blocked by another connection',
        {
          databaseName: name,
        },
      );
      if (blockedTimeout) return;
      blockedTimeout = setTimeout(() => {
        settle(() => reject(new Error('Database reset remained blocked')));
      }, RESET_DELETE_BLOCKED_TIMEOUT_MS);
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
export function resetAllDatabases(): Promise<void> {
  if (activeDatabaseReset) return activeDatabaseReset;
  if (partialDatabaseResetDetected) {
    return Promise.reject(new StartupDatabaseResetError('partial-reset'));
  }

  const operation = performDatabaseReset();
  let trackedOperation: Promise<void>;
  trackedOperation = operation.finally(() => {
    if (activeDatabaseReset === trackedOperation) activeDatabaseReset = null;
  });
  activeDatabaseReset = trackedOperation;
  return trackedOperation;
}

async function performDatabaseReset(): Promise<void> {
  logger.warn(
    'dbInitialization: resetAllDatabases — deleting the app-owned state and data databases',
  );
  let primaryDeletionStarted = false;
  try {
    assertAppOwnedLocalStorageAvailable();
    await beginIdbReset();
    // QNBS-v3: once either primary delete is issued, a timeout or failure is treated as potentially partial and the connection/write gate remains latched.
    primaryDeletionStarted = true;
    const results = await Promise.allSettled([deleteIdb(STATE_DB_NAME), deleteIdb(DATA_DB_NAME)]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('At least one app-owned database could not be deleted');
    }
    clearAppOwnedLegacyResetMarkersAfterPrimaryDataDeletion();
    logger.info('dbInitialization: resetAllDatabases — complete');
  } catch {
    if (primaryDeletionStarted) {
      partialDatabaseResetDetected = true;
      throw new StartupDatabaseResetError('partial-reset');
    }
    endIdbReset();
    throw new StartupDatabaseResetError('failed-before-primary-delete');
  }
}
