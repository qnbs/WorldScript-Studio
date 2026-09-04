/**
 * ProForge Run-History Store — persists completed/aborted pipeline runs per project.
 * QNBS-v3: The proForge slice is ephemeral (cleared on reload), so analytics comparisons across
 * runs were always empty after a refresh. This IDB-backed store survives reloads. Capped per
 * project to keep storage bounded.
 */

import type { PipelineRun } from '../../features/proForge/types';
import {
  beginIdbOpenAdmission,
  isIdbOpenStillValid,
  registerIdbConnectionCloser,
} from '../storage/idbResetGate';

const HISTORY_DB = 'proforge-run-history';
const HISTORY_VERSION = 1;
const STORE = 'history';
/** Keep at most this many runs per project (most recent first). */
export const MAX_RUN_HISTORY = 20;

let dbPromise: Promise<IDBDatabase> | null = null;
let database: IDBDatabase | null = null;

// QNBS-v3: this connection is cached indefinitely — a factory reset must close it or deleteDatabase(proforge-run-history) blocks.
registerIdbConnectionCloser(() => {
  database?.close();
  database = null;
  dbPromise = null;
});

function openHistoryDb(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  if (dbPromise) return dbPromise;
  // QNBS-v3: rejects immediately if a reset is currently draining — the generation check alone can't catch an open that STARTS mid-reset, since it would capture the reset's own already-bumped generation.
  const openGeneration = beginIdbOpenAdmission();
  if (openGeneration === null) {
    return Promise.reject(new Error('IndexedDB reset in progress'));
  }
  const thisOpen: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, HISTORY_VERSION);
    request.onerror = () => {
      reject(new Error('Failed to open ProForge history DB'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!isIdbOpenStillValid(openGeneration)) {
        db.close();
        reject(new Error('IndexedDB reset in progress'));
        return;
      }
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      database = db;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
  });
  dbPromise = thisOpen;
  // QNBS-v3: single ownership-checked cleanup for every settlement — .finally()'s callback always runs as a later microtask, so this always sees dbPromise already set to thisOpen. The trailing .catch(() => {}) only prevents an unhandled-rejection warning on this DISCARDED derived chain.
  thisOpen
    .finally(() => {
      if (dbPromise === thisOpen) dbPromise = null;
    })
    .catch(() => {});
  return thisOpen;
}

interface HistoryRecord {
  projectId: string;
  runs: PipelineRun[];
}

/** Persist the run history for a project (capped to MAX_RUN_HISTORY, most-recent-first). */
export async function saveRunHistory(projectId: string, runs: PipelineRun[]): Promise<void> {
  const db = await openHistoryDb();
  const record: HistoryRecord = { projectId, runs: runs.slice(0, MAX_RUN_HISTORY) };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    // QNBS-v3: Resolve only once the transaction COMMITS — an IDB write is not durable on
    // request.onsuccess; the tx can still abort (quota/commit failure) afterwards.
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Failed to save ProForge run history'));
    tx.onabort = () => reject(new Error('ProForge run-history transaction aborted'));
  });
}

/** Load the persisted run history for a project (empty array if none). */
export async function loadRunHistory(projectId: string): Promise<PipelineRun[]> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(projectId);
    request.onsuccess = () => resolve((request.result as HistoryRecord | undefined)?.runs ?? []);
    request.onerror = () => reject(new Error('Failed to load ProForge run history'));
  });
}

/** Reset the DB connection — test-only. */
export function _resetHistoryDbForTest(): void {
  database?.close();
  database = null;
  dbPromise = null;
}
