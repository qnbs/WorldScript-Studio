import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('logger', () => {
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

  it('logger.warn always calls console.warn', async () => {
    const { logger } = await import('../../services/logger');
    logger.warn('test warning');
    expect(console.warn).toHaveBeenCalledWith('[StoryCraft:WARN]', 'test warning');
  });

  it('logger.error always calls console.error', async () => {
    const { logger } = await import('../../services/logger');
    logger.error('test error');
    expect(console.error).toHaveBeenCalledWith('[StoryCraft:ERROR]', 'test error');
  });

  it('logger.info calls console.info in non-prod', async () => {
    const { logger } = await import('../../services/logger');
    logger.info('info msg');
    expect(console.info).toHaveBeenCalledWith('[StoryCraft:INFO]', 'info msg');
  });

  it('logger.debug does not call console.debug without debug flag', async () => {
    const { logger } = await import('../../services/logger');
    logger.debug('debug msg');
    expect(console.debug).not.toHaveBeenCalled();
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

describe('logger ring buffer', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('getRecentLogs returns entries logged via warn/error', async () => {
    const { logger, getRecentLogs, clearLogs } = await import('../../services/logger');
    clearLogs();
    logger.warn('ring-warn');
    logger.error('ring-error');
    const logs = getRecentLogs();
    expect(logs.some((e) => e.level === 'warn' && e.message.includes('ring-warn'))).toBe(true);
    expect(logs.some((e) => e.level === 'error' && e.message.includes('ring-error'))).toBe(true);
  });

  it('clearLogs empties the buffer', async () => {
    const { logger, getRecentLogs, clearLogs } = await import('../../services/logger');
    logger.error('before clear');
    clearLogs();
    expect(getRecentLogs()).toHaveLength(0);
  });

  it('formatLogsForReport returns ISO-timestamp lines', async () => {
    const { logger, clearLogs, formatLogsForReport } = await import('../../services/logger');
    clearLogs();
    logger.warn('report-test');
    const report = formatLogsForReport();
    expect(report).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report).toContain('[WARN]');
    expect(report).toContain('report-test');
  });
});
