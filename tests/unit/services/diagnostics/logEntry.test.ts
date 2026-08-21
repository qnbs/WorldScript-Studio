import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLogEntry,
  safeStringify,
  sanitizeLogContext,
} from '../../../../services/diagnostics/logEntry';

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
    expect(entry.message).toContain('failed boom');
    expect(entry.message).toContain('boom');
    expect(Object.keys(entry)).toEqual(['ts', 'level', 'module', 'message', 'context']);
  });

  it('serializes object arguments with the same redaction boundary', () => {
    const entry = createLogEntry('info', 'diagnostics', [
      'routing',
      { transcriptLength: 12, apiKey: 'secret' },
    ]);

    expect(entry.message).toBe('routing {"transcriptLength":12,"apiKey":"[REDACTED]"}');
  });

  // QNBS-v3: object arguments and recursive redaction protect every synchronous logging boundary.
  it('redacts sensitive keys recursively without mutating the input', () => {
    class SensitiveContainer {
      apiKey = 'class-secret';
    }

    const context = {
      nested: { token: 'nested-secret' },
      array: [{ password: 'array-secret', ivHex: 'array-iv-secret' }],
      userId: 'user-1',
      passphrase: 'secret',
      iv: 'direct-iv-secret',
      encryptionIv: 'encryption-iv-secret',
      initializationVector: 'initialization-vector-secret',
      ivory: 'safe-word',
      privilege: 'safe-word',
      classValue: new SensitiveContainer(),
      circular: {} as Record<string, unknown>,
    };
    const circular = context.circular;
    circular['self'] = circular;

    expect(sanitizeLogContext(context)).toEqual({
      nested: { token: '[REDACTED]' },
      array: [{ password: '[REDACTED]', ivHex: '[REDACTED]' }],
      userId: 'user-1',
      passphrase: '[REDACTED]',
      iv: '[REDACTED]',
      encryptionIv: '[REDACTED]',
      initializationVector: '[REDACTED]',
      ivory: 'safe-word',
      privilege: 'safe-word',
      classValue: '[Unserializable]',
      circular: { self: { '[CIRCULAR]': '[REDACTED]' } },
    });
    expect(context.nested.token).toBe('nested-secret');
    expect(context.array[0]?.password).toBe('array-secret');
    expect(context.array[0]?.ivHex).toBe('array-iv-secret');
    expect(context.passphrase).toBe('secret');
  });

  it('returns a safe marker when JSON serialization cannot produce a value', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(safeStringify(undefined)).toBe('[Unserializable]');
    expect(safeStringify(circular)).toBe('[Unserializable]');
  });
});
