// QNBS-v3: Keep browser/Tauri sink dispatch behind an adapter boundary around portable LogEntry.

import { desktopPlatform } from '../desktopPlatform';
import {
  beginIdbOpenAdmission,
  isIdbOpenStillValid,
  registerIdbConnectionCloser,
} from '../storage/idbResetGate';
import { type LogEntry, safeStringify } from './logEntry';

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

// --- IDB sink ---------------------------------------------------------------

const IDB_DB_NAME = 'worldscript-logs-db';
const IDB_STORE = 'logs';
const IDB_CAP = 1_000;

let _idbDb: IDBDatabase | null = null;
let _idbOpenPromise: Promise<IDBDatabase> | null = null;
let _idbRecordCount: number | null = null;
let _idbWriteQueue: Promise<void> = Promise.resolve();

// QNBS-v3: this connection is opened on the first log write and cached indefinitely — a factory reset must close it (and drop the cached record count, which describes this now-closed connection's contents) or its own logging call keeps worldscript-logs-db blocked.
registerIdbConnectionCloser(() => {
  _idbDb?.close();
  _idbDb = null;
  _idbRecordCount = null;
});

function openLogDb(): Promise<IDBDatabase> {
  if (_idbDb) return Promise.resolve(_idbDb);
  if (_idbOpenPromise) return _idbOpenPromise;
  // QNBS-v3: rejects immediately if a reset is currently draining — the generation check alone can't catch an open that STARTS mid-reset, since it would capture the reset's own already-bumped generation.
  const openGeneration = beginIdbOpenAdmission();
  if (openGeneration === null) {
    return Promise.reject(new Error('IndexedDB reset in progress'));
  }
  const thisOpen: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!isIdbOpenStillValid(openGeneration)) {
        db.close();
        reject(new Error('IndexedDB reset in progress'));
        return;
      }
      // QNBS-v3: another tab's factory reset fires versionchange here first — close and invalidate so this tab re-opens fresh next write instead of holding a connection that blocks that reset.
      db.onversionchange = () => {
        db.close();
        _idbDb = null;
        _idbRecordCount = null;
      };
      _idbDb = db;
      resolve(_idbDb);
    };
    req.onerror = (e) => {
      reject((e.target as IDBOpenDBRequest).error);
    };
  });
  _idbOpenPromise = thisOpen;
  // QNBS-v3: single ownership-checked cleanup for every settlement — .finally()'s callback always runs as a later microtask, so this always sees _idbOpenPromise already set to thisOpen. The trailing .catch(() => {}) only prevents an unhandled-rejection warning on this DISCARDED derived chain.
  thisOpen
    .finally(() => {
      if (_idbOpenPromise === thisOpen) _idbOpenPromise = null;
    })
    .catch(() => {});
  return thisOpen;
}

// QNBS-v3: serialize IDB writes and track a bounded count to prevent burst logging from blocking or exhausting storage.
function writeToIdb(entry: LogEntry): void {
  if (typeof indexedDB === 'undefined') return;
  _idbWriteQueue = _idbWriteQueue
    .then(async () => {
      const db = await openLogDb();
      if (_idbRecordCount === null) {
        _idbRecordCount = await countIdbRecords(db);
      }
      await addIdbRecord(db, entry);
      _idbRecordCount += 1;
      const excess = _idbRecordCount - IDB_CAP;
      if (excess > 0) {
        _idbRecordCount -= await deleteOldestIdbRecords(db, excess);
      }
    })
    .catch(() => {
      // silently skip — logger must never throw
    });
  void _idbWriteQueue;
}

function countIdbRecords(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function addIdbRecord(db: IDBDatabase, entry: LogEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).add(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteOldestIdbRecords(db: IDBDatabase, count: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE, 'readwrite');
    const request = transaction.objectStore(IDB_STORE).openCursor();
    let deleted = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && deleted < count) {
        cursor.delete();
        deleted += 1;
        cursor.continue();
      } else {
        resolve(deleted);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

// --- Tauri JSONL sink -------------------------------------------------------

let _tauriLogDir: string | null = null;

let _tauriWriteQueue: Promise<void> = Promise.resolve();

// QNBS-v3: queue JSONL appends and safe-stringify entries so concurrent native writes remain valid and non-throwing.
function writeToTauri(entry: LogEntry): void {
  _tauriWriteQueue = _tauriWriteQueue
    .then(async () => {
      if (!desktopPlatform.runtime.isDesktop) return;
      if (!_tauriLogDir) {
        const base = await desktopPlatform.persistence.appDataDir();
        const logDir = await desktopPlatform.persistence.join(base, 'logs');
        await desktopPlatform.filesystem.mkdir(logDir, { recursive: true });
        _tauriLogDir = logDir;
      }
      const date = new Date(entry.ts).toISOString().slice(0, 10);
      const path = await desktopPlatform.persistence.join(
        _tauriLogDir,
        `worldscript-${date}.jsonl`,
      );
      await desktopPlatform.filesystem.writeTextFile(path, `${safeStringify(entry)}\n`, {
        append: true,
        create: true,
      });
    })
    .catch(() => {
      // silently skip — Tauri JSONL sink is non-critical
    });
  void _tauriWriteQueue;
}

// --- Console sink (DEV only) ------------------------------------------------

function writeToConsole(entry: LogEntry): void {
  if (!isDev) return;
  const tag = `[WorldScript:${entry.level.toUpperCase()}:${entry.module}]`;
  const ctx = entry.context ? ` ${safeStringify(entry.context)}` : '';
  const msg = entry.message + ctx;
  switch (entry.level) {
    case 'debug':
      console.debug(tag, msg);
      break;
    case 'info':
      console.info(tag, msg);
      break;
    case 'warn':
      console.warn(tag, msg);
      break;
    case 'error':
      console.error(tag, msg);
      break;
  }
}

export function writeLogEntryToSinks(entry: LogEntry): void {
  writeToConsole(entry);
  writeToIdb(entry);
  writeToTauri(entry);
}
