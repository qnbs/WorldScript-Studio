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

  it('preserves the existing top-level redaction scope', () => {
    const context = {
      nested: { token: 'kept as an opaque value' },
      userId: 'user-1',
      passphrase: 'secret',
    };

    expect(sanitizeLogContext(context)).toEqual({
      nested: { token: 'kept as an opaque value' },
      userId: 'user-1',
      passphrase: '[REDACTED]',
    });
    expect(context.passphrase).toBe('secret');
  });
});
