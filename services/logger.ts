const isProd = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD);
const hasLocalStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
const debugEnabled = !isProd && hasLocalStorage && window.localStorage.getItem('debug') === 'true';

const formatMessage = (level: string, args: unknown[]) => [`[StoryCraft:${level}]`, ...args];

export const logger = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) {
      console.log(...formatMessage('DEBUG', args));
    }
  },
  info: (...args: unknown[]) => {
    if (!isProd) {
      console.log(...formatMessage('INFO', args));
    }
  },
  warn: (...args: unknown[]) => {
    console.warn(...formatMessage('WARN', args));
  },
  error: (...args: unknown[]) => {
    console.error(...formatMessage('ERROR', args));
  },
};

export const enableDebugLogging = (): void => {
  if (hasLocalStorage) {
    window.localStorage.setItem('debug', 'true');
  }
};

export const disableDebugLogging = (): void => {
  if (hasLocalStorage) {
    window.localStorage.removeItem('debug');
  }
};
