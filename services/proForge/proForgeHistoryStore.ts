/**
 * ProForge Run-History Store — persists completed/aborted pipeline runs per project.
 * QNBS-v3: The proForge slice is ephemeral (cleared on reload), so analytics comparisons across
 * runs were always empty after a refresh. This IDB-backed store survives reloads. Capped per
 * project to keep storage bounded.
 */

import type { PipelineRun } from '../../features/proForge/types';
import {
  prepareSecureRecordPayload,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayload,
  reEncryptSecureRecordEnvelope,
  type SecureRecordEnvelope,
} from '../storage/storageEncryptionService';

const SECURE_STORE = 'proforge-history';

const HISTORY_DB = 'proforge-run-history';
const HISTORY_VERSION = 1;
const STORE = 'history';
/** Keep at most this many runs per project (most recent first). */
export const MAX_RUN_HISTORY = 20;
const RECORD_SCHEMA_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let dbHandle: IDBDatabase | null = null;

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
    request.onsuccess = () => {
      dbHandle = request.result;
      dbHandle.onversionchange = () => {
        dbHandle?.close();
        dbHandle = null;
        dbPromise = null;
      };
      resolve(request.result);
    };
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
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: { runs: PipelineRun[] } | SecureRecordEnvelope;
}

interface LegacyHistoryRecord {
  projectId: string;
  runs: PipelineRun[];
}

async function encodeHistory(projectId: string, runs: PipelineRun[]): Promise<HistoryRecord> {
  return {
    projectId,
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(
      { runs: runs.slice(0, MAX_RUN_HISTORY) },
      {
        store: SECURE_STORE,
        recordId: projectId,
      },
    ),
  };
}

async function putHistory(db: IDBDatabase, record: HistoryRecord): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Failed to save ProForge run history'));
    transaction.onabort = () => reject(new Error('ProForge run-history transaction aborted'));
  });
}

/** Persist the run history for a project (capped to MAX_RUN_HISTORY, most-recent-first). */
export async function saveRunHistory(projectId: string, runs: PipelineRun[]): Promise<void> {
  // QNBS-v3: Resolve WebCrypto before opening IDB so the transaction cannot become inactive.
  const record = await encodeHistory(projectId, runs);
  const db = await openHistoryDb();
  await putHistory(db, record);
}

/** Load the persisted run history for a project (empty array if none). */
export async function loadRunHistory(projectId: string): Promise<PipelineRun[]> {
  const db = await openHistoryDb();
  const stored = await new Promise<HistoryRecord | LegacyHistoryRecord | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(projectId);
      request.onsuccess = () => resolve(request.result as HistoryRecord | undefined);
      request.onerror = () => reject(new Error('Failed to load ProForge run history'));
    },
  );
  if (!stored) return [];
  const rawPayload = 'payload' in stored ? stored.payload : { runs: stored.runs };
  const decoded = await readSecureRecordPayload<{ runs: PipelineRun[] }>(rawPayload, {
    store: SECURE_STORE,
    recordId: projectId,
  });
  if (decoded.needsMigration) {
    await putHistory(db, await encodeHistory(projectId, decoded.value.runs));
  }
  return decoded.value.runs;
}

/** Reset the DB connection — test-only. */
export function _resetHistoryDbForTest(): void {
  dbHandle?.close();
  dbHandle = null;
  dbPromise = null;
}

/** Decrypt all history payloads to plaintext before encryption is disabled. */
export async function migrateProForgeHistoryForDisable(): Promise<void> {
  const db = await openHistoryDb();
  const raw = await new Promise<HistoryRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as HistoryRecord[]);
    req.onerror = () => reject(new Error('Failed to load ProForge history'));
  });
  const plaintext: HistoryRecord[] = [];
  for (const stored of raw) {
    const runs = await loadRunHistory(stored.projectId);
    plaintext.push({
      projectId: stored.projectId,
      schemaVersion: RECORD_SCHEMA_VERSION,
      payload: { runs },
    });
  }
  for (const record of plaintext) {
    await putHistory(db, record);
  }
}

/** Re-encrypt all history payloads during passphrase rotation. */
export async function reEncryptProForgeHistory(
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  const db = await openHistoryDb();
  const raw = await new Promise<HistoryRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as HistoryRecord[]);
    req.onerror = () => reject(new Error('Failed to load ProForge history'));
  });
  for (const stored of raw) {
    const context = { store: SECURE_STORE, recordId: stored.projectId };
    const payload =
      stored.payload && typeof stored.payload === 'object' && 'ciphertext' in stored.payload
        ? await reEncryptSecureRecordEnvelope(
            stored.payload as SecureRecordEnvelope,
            context,
            oldKey,
            newKey,
          )
        : await prepareSecureRecordPayloadWithKey(stored.payload, context, newKey);
    await putHistory(db, { ...stored, payload });
  }
}
