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
