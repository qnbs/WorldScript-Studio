// QNBS-v3: B-6 StructuredLogger — replaces ring-buffer with IDB + Tauri JSONL sinks

// QNBS-v3 (T0): canonical Tauri detection (now `__TAURI_INTERNALS__`-aware). tauriRuntime is a
// dependency-free leaf, so importing it into the logger introduces no cycle.
import { isTauriRuntime } from './tauriRuntime';

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

// --- Types ------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

// --- GDPR sanitization ------------------------------------------------------

const SENSITIVE_KEY_RE = /key|token|password|passphrase/i;

export function sanitizeLogContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

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
        const cursorReq = store.openCursor(); // forward = oldest first
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

// Dynamic types for lazily-loaded Tauri modules
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

// --- In-memory cache (powers getRecentLogs backward compat) ----------------

const CACHE_CAP = 200;
const _cache: LogEntry[] = [];

// --- Core write -------------------------------------------------------------

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}`.trim() : String(a)))
    .join(' ');
}

function write(
  level: LogLevel,
  module: string,
  args: unknown[],
  context?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    module,
    message: formatArgs(args),
    ...(context ? { context: sanitizeLogContext(context) } : {}),
  };
  writeToConsole(entry);
  writeToIdb(entry);
  writeToTauri(entry);
  if (_cache.length >= CACHE_CAP) _cache.shift();
  _cache.push(entry);
}

// --- Module logger factory --------------------------------------------------

export interface ModuleLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  withContext(ctx: Record<string, unknown>): ModuleLogger;
}

export function createLogger(module: string): ModuleLogger {
  return {
    debug: (...args) => write('debug', module, args),
    info: (...args) => write('info', module, args),
    warn: (...args) => write('warn', module, args),
    error: (...args) => write('error', module, args),
    withContext: (ctx) => ({
      debug: (...args) => write('debug', module, args, ctx),
      info: (...args) => write('info', module, args, ctx),
      warn: (...args) => write('warn', module, args, ctx),
      error: (...args) => write('error', module, args, ctx),
      withContext: (innerCtx) => createLogger(module).withContext({ ...ctx, ...innerCtx }),
    }),
  };
}

// --- Correlation IDs --------------------------------------------------------

let _correlationSeq = 0;

/**
 * Short, opaque id to correlate the log lines of one logical operation (e.g. an AI request)
 * across async boundaries. QNBS-v3 (Phase 1): never derived from user content — safe to log.
 * A monotonic session counter guarantees uniqueness *within* a session (no merged operations
 * even if the random fragment collides); the random fragment adds entropy across sessions/tabs.
 */
export function newCorrelationId(prefix = 'cid'): string {
  const seq = (++_correlationSeq).toString(36);
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${seq}-${rand}`;
}

// --- Backward-compat default logger -----------------------------------------
// QNBS-v3: Module auto-extracted from [bracket] prefix in first string arg

function extractModule(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') {
    const match = /^\[([^\]]+)\]/.exec(first);
    if (match?.[1]) return match[1];
  }
  return 'app';
}

export const logger = {
  debug: (...args: unknown[]) => write('debug', extractModule(args), args),
  info: (...args: unknown[]) => write('info', extractModule(args), args),
  warn: (...args: unknown[]) => write('warn', extractModule(args), args),
  error: (...args: unknown[]) => write('error', extractModule(args), args),
};

// --- Legacy ring-buffer API (backward-compatible) ---------------------------

/** Returns the last `n` log entries from the in-memory cache (default: all). */
export function getRecentLogs(n = CACHE_CAP): LogEntry[] {
  return _cache.slice(-n);
}

/** Formats cached logs as plain-text for bug reports. */
export function formatLogsForReport(n = 100): string {
  return getRecentLogs(n)
    .map(({ ts, level, module, message }) => {
      const time = new Date(ts).toISOString();
      return `${time} [${level.toUpperCase()}:${module}] ${message}`;
    })
    .join('\n');
}

/** Clears the in-memory cache. Does not affect IDB or Tauri JSONL. */
export function clearLogs(): void {
  _cache.length = 0;
}

const hasLocalStorage =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  typeof window.localStorage.getItem === 'function';

export const enableDebugLogging = (): void => {
  if (hasLocalStorage && typeof window.localStorage.setItem === 'function') {
    window.localStorage.setItem('debug', 'true');
  }
};

export const disableDebugLogging = (): void => {
  if (hasLocalStorage && typeof window.localStorage.removeItem === 'function') {
    window.localStorage.removeItem('debug');
  }
};
