import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('logger — console output', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('logger.warn calls console.warn with structured tag in DEV', async () => {
    const { logger } = await import('../../services/logger');
    logger.warn('test warning');
    expect(console.warn).toHaveBeenCalledWith('[WorldScript:WARN:app]', 'test warning');
  });

  it('logger.error calls console.error with structured tag in DEV', async () => {
    const { logger } = await import('../../services/logger');
    logger.error('test error');
    expect(console.error).toHaveBeenCalledWith('[WorldScript:ERROR:app]', 'test error');
  });

  it('logger.info calls console.info in DEV', async () => {
    const { logger } = await import('../../services/logger');
    logger.info('info msg');
    expect(console.info).toHaveBeenCalledWith('[WorldScript:INFO:app]', 'info msg');
  });

  it('logger.debug calls console.debug in DEV', async () => {
    const { logger } = await import('../../services/logger');
    logger.debug('debug msg');
    expect(console.debug).toHaveBeenCalledWith('[WorldScript:DEBUG:app]', 'debug msg');
  });

  it('auto-extracts module from [bracket] prefix', async () => {
    const { logger } = await import('../../services/logger');
    logger.warn('[createSttEngine] something failed');
    expect(console.warn).toHaveBeenCalledWith(
      '[WorldScript:WARN:createSttEngine]',
      '[createSttEngine] something failed',
    );
  });

  it('enableDebugLogging sets localStorage debug=true', async () => {
    const { enableDebugLogging } = await import('../../services/logger');
    enableDebugLogging();
    expect(localStorage.getItem('debug')).toBe('true');
  });

  it('disableDebugLogging removes debug from localStorage', async () => {
    localStorage.setItem('debug', 'true');
    const { disableDebugLogging } = await import('../../services/logger');
    disableDebugLogging();
    expect(localStorage.getItem('debug')).toBeNull();
  });
});

describe('logger — in-memory cache', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('getRecentLogs returns entries with module field', async () => {
    const { logger, getRecentLogs, clearLogs } = await import('../../services/logger');
    clearLogs();
    logger.warn('ring-warn');
    logger.error('ring-error');
    const logs = getRecentLogs();
    expect(logs.some((e) => e.level === 'warn' && e.message.includes('ring-warn'))).toBe(true);
    expect(logs.some((e) => e.level === 'error' && e.message.includes('ring-error'))).toBe(true);
    expect(logs.every((e) => typeof e.module === 'string')).toBe(true);
  });

  it('clearLogs empties the cache', async () => {
    const { logger, getRecentLogs, clearLogs } = await import('../../services/logger');
    logger.error('before clear');
    clearLogs();
    expect(getRecentLogs()).toHaveLength(0);
  });

  it('formatLogsForReport includes module in format string', async () => {
    const { logger, clearLogs, formatLogsForReport } = await import('../../services/logger');
    clearLogs();
    logger.warn('report-test');
    const report = formatLogsForReport();
    expect(report).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report).toContain('[WARN:app]');
    expect(report).toContain('report-test');
  });
});

describe('sanitizeLogContext', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('redacts keys matching sensitive pattern', async () => {
    const { sanitizeLogContext } = await import('../../services/logger');
    const result = sanitizeLogContext({
      apiKey: 'secret123',
      token: 'bearer-xyz',
      password: 'hunter2',
      passphrase: 'correct-horse',
      userId: 'user-1',
      message: 'hello',
    });
    expect(result['apiKey']).toBe('[REDACTED]');
    expect(result['token']).toBe('[REDACTED]');
    expect(result['password']).toBe('[REDACTED]');
    expect(result['passphrase']).toBe('[REDACTED]');
    expect(result['userId']).toBe('user-1');
    expect(result['message']).toBe('hello');
  });

  it('preserves non-sensitive keys unchanged', async () => {
    const { sanitizeLogContext } = await import('../../services/logger');
    const result = sanitizeLogContext({ count: 42, label: 'test', nested: { x: 1 } });
    expect(result['count']).toBe(42);
    expect(result['label']).toBe('test');
    expect(result['nested']).toEqual({ x: 1 });
  });

  it('is case-insensitive on key names', async () => {
    const { sanitizeLogContext } = await import('../../services/logger');
    const result = sanitizeLogContext({ API_KEY: 'val', TOKEN_VALUE: 'val2', userToken: 'val3' });
    expect(result['API_KEY']).toBe('[REDACTED]');
    expect(result['TOKEN_VALUE']).toBe('[REDACTED]');
    expect(result['userToken']).toBe('[REDACTED]');
  });
});

describe('createLogger factory', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('createLogger sets module on all entries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createLogger, getRecentLogs, clearLogs } = await import('../../services/logger');
    clearLogs();
    const log = createLogger('myService');
    log.warn('something happened');
    const logs = getRecentLogs();
    const entry = logs.find((e) => e.message.includes('something happened'));
    expect(entry?.module).toBe('myService');
    expect(console.warn).toHaveBeenCalledWith('[WorldScript:WARN:myService]', 'something happened');
  });

  it('withContext includes sanitized context on entries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createLogger, getRecentLogs, clearLogs } = await import('../../services/logger');
    clearLogs();
    const log = createLogger('authModule').withContext({ userId: 'u1', apiKey: 'secret' });
    log.error('auth failed');
    const entry = getRecentLogs().find((e) => e.message.includes('auth failed'));
    expect(entry?.context?.['userId']).toBe('u1');
    expect(entry?.context?.['apiKey']).toBe('[REDACTED]');
  });

  it('withContext can be chained', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createLogger, getRecentLogs, clearLogs } = await import('../../services/logger');
    clearLogs();
    const log = createLogger('pipeline')
      .withContext({ stage: 'proof' })
      .withContext({ attempt: 2 });
    log.info('retry');
    const entry = getRecentLogs().find((e) => e.message === 'retry');
    expect(entry?.context?.['stage']).toBe('proof');
    expect(entry?.context?.['attempt']).toBe(2);
  });
});
