/* eslint-disable no-console -- Logger is the designated console wrapper */
const isProd = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD);
const hasLocalStorage =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  typeof window.localStorage.getItem === 'function';
const debugEnabled = !isProd && hasLocalStorage && window.localStorage.getItem('debug') === 'true';

// --- Ring buffer -----------------------------------------------------------

export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

const RING_CAPACITY = 200;
const ring: LogEntry[] = [];

function push(level: LogEntry['level'], args: unknown[]): void {
  const message = args
    .map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}`.trim() : String(a)))
    .join(' ');
  if (ring.length >= RING_CAPACITY) ring.shift();
  ring.push({ ts: Date.now(), level, message });
}

// --- Public API ------------------------------------------------------------

const formatMessage = (level: string, args: unknown[]) => [`[StoryCraft:${level}]`, ...args];

export const logger = {
  debug: (...args: unknown[]) => {
    push('debug', args);
    if (debugEnabled) console.debug(...formatMessage('DEBUG', args));
  },
  info: (...args: unknown[]) => {
    push('info', args);
    if (!isProd) console.info(...formatMessage('INFO', args));
  },
  warn: (...args: unknown[]) => {
    push('warn', args);
    console.warn(...formatMessage('WARN', args));
  },
  error: (...args: unknown[]) => {
    push('error', args);
    console.error(...formatMessage('ERROR', args));
  },
};

/** Returns the last `n` log entries (default: all buffered). */
export function getRecentLogs(n = RING_CAPACITY): LogEntry[] {
  return ring.slice(-n);
}

/** Formats buffered logs as a plain-text string suitable for a bug report. */
export function formatLogsForReport(n = 100): string {
  return getRecentLogs(n)
    .map(({ ts, level, message }) => {
      const time = new Date(ts).toISOString();
      return `${time} [${level.toUpperCase()}] ${message}`;
    })
    .join('\n');
}

/** Clears the in-memory ring buffer. */
export function clearLogs(): void {
  ring.length = 0;
}

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
