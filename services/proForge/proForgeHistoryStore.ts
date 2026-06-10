/**
 * ProForge Run-History Store — persists completed/aborted pipeline runs per project.
 * QNBS-v3: The proForge slice is ephemeral (cleared on reload), so analytics comparisons across
 * runs were always empty after a refresh. This IDB-backed store survives reloads. Capped per
 * project to keep storage bounded.
 */

import type { PipelineRun } from '../../features/proForge/types';

const HISTORY_DB = 'proforge-run-history';
const HISTORY_VERSION = 1;
const STORE = 'history';
/** Keep at most this many runs per project (most recent first). */
export const MAX_RUN_HISTORY = 20;

let dbPromise: Promise<IDBDatabase> | null = null;

function openHistoryDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, HISTORY_VERSION);
    request.onerror = () => {
      // QNBS-v3: Don't memoize a rejected promise — a transient open failure (quota, locked DB)
      // must not disable run-history for the rest of the session. Clear the cache so later
      // calls retry the open.
      dbPromise = null;
      reject(new Error('Failed to open ProForge history DB'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
  });
  return dbPromise;
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
  dbPromise = null;
}
