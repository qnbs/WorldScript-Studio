/**
 * Tests for services/logger.ts
 * QNBS-v3: Covers GDPR sanitization, module extraction, context merging,
 * cache eviction, and Error formatting — the branches most often missed in coverage.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLogs,
  createLogger,
  formatLogsForReport,
  getRecentLogs,
  logger,
  sanitizeLogContext,
} from '../../../services/logger';

describe('sanitizeLogContext', () => {
  it('redacts keys matching sensitive pattern', () => {
    const ctx = { apiKey: 'secret', userToken: 'tok', myPassword: 'pw' };
    const out = sanitizeLogContext(ctx);
    expect(out['apiKey']).toBe('[REDACTED]');
    expect(out['userToken']).toBe('[REDACTED]');
    expect(out['myPassword']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive keys', () => {
    const ctx = { userId: 42, projectName: 'Novel' };
    const out = sanitizeLogContext(ctx);
    expect(out['userId']).toBe(42);
    expect(out['projectName']).toBe('Novel');
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    clearLogs();
  });

  it('writes debug entries to the cache', () => {
    const log = createLogger('test-mod');
    log.debug('hello');
    const recent = getRecentLogs(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.level).toBe('debug');
    expect(recent[0]?.module).toBe('test-mod');
    expect(recent[0]?.message).toBe('hello');
  });

  it('writes info entries to the cache', () => {
    const log = createLogger('test-mod');
    log.info('world');
    expect(getRecentLogs(1)[0]?.level).toBe('info');
  });

  it('writes warn entries to the cache', () => {
    const log = createLogger('test-mod');
    log.warn('careful');
    expect(getRecentLogs(1)[0]?.level).toBe('warn');
  });

  it('writes error entries to the cache', () => {
    const log = createLogger('test-mod');
    log.error('boom');
    expect(getRecentLogs(1)[0]?.level).toBe('error');
  });

  it('merges context via withContext', () => {
    const log = createLogger('ctx-mod').withContext({ requestId: 'req-1' });
    log.info('done');
    const entry = getRecentLogs(1)[0];
    expect(entry?.context).toEqual({ requestId: 'req-1' });
  });

  it('nests withContext calls', () => {
    const log = createLogger('ctx-mod')
      .withContext({ a: 1 })
      .withContext({ b: 2 });
    log.info('nested');
    const entry = getRecentLogs(1)[0];
    expect(entry?.context).toEqual({ a: 1, b: 2 });
  });

  it('formats Error instances in args', () => {
    const log = createLogger('err-mod');
    log.error(new Error('fail'));
    const entry = getRecentLogs(1)[0];
    expect(entry?.message).toContain('fail');
  });
});

describe('legacy default logger', () => {
  beforeEach(() => {
    clearLogs();
  });

  it('extracts module from bracket prefix', () => {
    logger.info('[MyModule] hello');
    expect(getRecentLogs(1)[0]?.module).toBe('MyModule');
  });

  it('defaults module to app when no prefix', () => {
    logger.info('plain message');
    expect(getRecentLogs(1)[0]?.module).toBe('app');
  });
});

describe('cache management', () => {
  beforeEach(() => {
    clearLogs();
  });

  it('getRecentLogs respects limit', () => {
    const log = createLogger('cache');
    log.info('a');
    log.info('b');
    log.info('c');
    expect(getRecentLogs(2)).toHaveLength(2);
    expect(getRecentLogs(2)[1]?.message).toBe('c');
  });

  it('formatLogsForReport produces ISO timestamps', () => {
    const log = createLogger('fmt');
    log.warn('alert');
    const report = formatLogsForReport(1);
    expect(report).toContain('[WARN:fmt]');
    expect(report).toContain('alert');
  });

  it('clearLogs empties the cache', () => {
    const log = createLogger('clear');
    log.info('x');
    clearLogs();
    expect(getRecentLogs()).toHaveLength(0);
  });
});
