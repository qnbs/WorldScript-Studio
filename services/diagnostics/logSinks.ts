// QNBS-v3: Keep browser/Tauri sink dispatch behind an adapter boundary around portable LogEntry.

import { isTauriRuntime } from '../tauriRuntime';
import type { LogEntry } from './logEntry';

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

// --- IDB sink ---------------------------------------------------------------

const IDB_DB_NAME = 'worldscript-logs-db';
const IDB_STORE = 'logs';
const IDB_CAP = 1_000;

let _idbDb: IDBDatabase | null = null;
let _idbOpenPromise: Promise<IDBDatabase> | null = null;

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

function writeToIdb(entry: LogEntry): void {
  if (typeof indexedDB === 'undefined') return;
  void openLogDb()
    .then((db) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.add(entry);
      // LRU eviction: prune oldest entries when over capacity
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - IDB_CAP;
        if (excess <= 0) return;
        const cursorReq = store.openCursor();
        let deleted = 0;
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor && deleted < excess) {
            cursor.delete();
            deleted++;
            cursor.continue();
          }
        };
      };
    })
    .catch(() => {
      // silently skip — logger must never throw
    });
}

// --- Tauri JSONL sink -------------------------------------------------------

type TauriFsWrite = (path: string, data: string, opts?: Record<string, unknown>) => Promise<void>;
type TauriMkdir = (path: string, opts?: Record<string, unknown>) => Promise<void>;
type TauriPathFns = {
  appDataDir(): Promise<string>;
  join(...p: string[]): Promise<string>;
};

let _tauriFs: TauriFsWrite | null = null;
let _tauriMkdir: TauriMkdir | null = null;
let _tauriPath: TauriPathFns | null = null;
let _tauriChecked = false;
let _tauriLogDir: string | null = null;

async function loadTauriSink(): Promise<{
  fs: TauriFsWrite;
  mkdir: TauriMkdir;
  path: TauriPathFns;
} | null> {
  if (_tauriChecked) {
    return _tauriFs && _tauriMkdir && _tauriPath
      ? { fs: _tauriFs, mkdir: _tauriMkdir, path: _tauriPath }
      : null;
  }
  _tauriChecked = true;
  if (!isTauriRuntime()) return null;
  try {
    const [fsM, pathM] = await Promise.all([
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ]);
    _tauriFs = fsM.writeTextFile as unknown as TauriFsWrite;
    _tauriMkdir = fsM.mkdir as unknown as TauriMkdir;
    _tauriPath = { appDataDir: pathM.appDataDir, join: pathM.join };
    return { fs: _tauriFs, mkdir: _tauriMkdir, path: _tauriPath };
  } catch {
    return null;
  }
}

function writeToTauri(entry: LogEntry): void {
  void loadTauriSink()
    .then(async (mods) => {
      if (!mods) return;
      if (!_tauriLogDir) {
        const base = await mods.path.appDataDir();
        _tauriLogDir = await mods.path.join(base, 'logs');
        await mods.mkdir(_tauriLogDir, { recursive: true });
      }
      const date = new Date(entry.ts).toISOString().slice(0, 10);
      const path = await mods.path.join(_tauriLogDir, `worldscript-${date}.jsonl`);
      await mods.fs(path, `${JSON.stringify(entry)}\n`, { append: true, create: true });
    })
    .catch(() => {
      // silently skip — Tauri JSONL sink is non-critical
    });
}

// --- Console sink (DEV only) ------------------------------------------------

function writeToConsole(entry: LogEntry): void {
  if (!isDev) return;
  const tag = `[WorldScript:${entry.level.toUpperCase()}:${entry.module}]`;
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
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
