// QNBS-v3: Keep browser/Tauri sink dispatch behind an adapter boundary around portable LogEntry.

import { desktopPlatform } from '../desktopPlatform';
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

function openLogDb(): Promise<IDBDatabase> {
  if (_idbDb) return Promise.resolve(_idbDb);
  if (_idbOpenPromise) return _idbOpenPromise;
  _idbOpenPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      _idbDb = (e.target as IDBOpenDBRequest).result;
      _idbOpenPromise = null;
      resolve(_idbDb);
    };
    req.onerror = (e) => {
      _idbOpenPromise = null;
      reject((e.target as IDBOpenDBRequest).error);
    };
  });
  return _idbOpenPromise;
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
