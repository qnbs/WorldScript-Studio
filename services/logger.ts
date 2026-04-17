/* eslint-disable no-console -- Logger is the designated console wrapper */
const isProd = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD);
const hasLocalStorage =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  typeof window.localStorage.getItem === 'function';
const debugEnabled = !isProd && hasLocalStorage && window.localStorage.getItem('debug') === 'true';

const formatMessage = (level: string, args: unknown[]) => [`[StoryCraft:${level}]`, ...args];

export const logger = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.debug(...formatMessage('DEBUG', args));
  },
  info: (...args: unknown[]) => {
    if (!isProd) console.info(...formatMessage('INFO', args));
  },
  warn: (...args: unknown[]) => {
    console.warn(...formatMessage('WARN', args));
  },
  error: (...args: unknown[]) => {
    console.error(...formatMessage('ERROR', args));
  },
};

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
