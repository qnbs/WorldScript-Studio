import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogEntry, sanitizeLogContext } from '../../../../services/diagnostics/logEntry';

describe('renderer-neutral log entry boundary', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the wire-shaped entry without renderer-specific fields', () => {
    const entry = createLogEntry('warn', 'diagnostics', ['failed', new Error('boom')], {
      requestId: 'req-1',
      apiKey: 'secret',
    });

    expect(entry).toMatchObject({
      ts: 1_700_000_000_000,
      level: 'warn',
      module: 'diagnostics',
      context: { requestId: 'req-1', apiKey: '[REDACTED]' },
    });
    expect(entry.message).toContain('failed boom Error: boom');
    expect(Object.keys(entry)).toEqual(['ts', 'level', 'module', 'message', 'context']);
  });

  it('redacts sensitive keys recursively without mutating the input', () => {
    const context = {
      nested: { token: 'nested-secret' },
      array: [{ password: 'array-secret' }],
      userId: 'user-1',
      passphrase: 'secret',
    };

    expect(sanitizeLogContext(context)).toEqual({
      nested: { token: '[REDACTED]' },
      array: [{ password: '[REDACTED]' }],
      userId: 'user-1',
      passphrase: '[REDACTED]',
    });
    expect(context.nested.token).toBe('nested-secret');
    expect(context.array[0]?.password).toBe('array-secret');
    expect(context.passphrase).toBe('secret');
  });
});
