// QNBS-v3: B-6 StructuredLogger — replaces ring-buffer with IDB + Tauri JSONL sinks

import type { LogEntry, LogLevel } from './diagnostics/logEntry';
import { createLogEntry } from './diagnostics/logEntry';
import { writeLogEntryToSinks } from './diagnostics/logSinks';

export type { LogEntry, LogLevel } from './diagnostics/logEntry';
export { sanitizeLogContext } from './diagnostics/logEntry';

// --- In-memory cache (powers getRecentLogs backward compat) ----------------

const CACHE_CAP = 200;
const _cache: LogEntry[] = [];

function write(
  level: LogLevel,
  module: string,
  args: unknown[],
  context?: Record<string, unknown>,
): void {
  const entry = createLogEntry(level, module, args, context);
  writeLogEntryToSinks(entry);
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
