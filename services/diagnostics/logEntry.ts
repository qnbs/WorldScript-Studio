import { sanitizeDiagnosticsContext } from '@domain/desktop-contracts';

// QNBS-v3: Keep log construction and redaction renderer-neutral for future Core authority work.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

export const sanitizeLogContext = sanitizeDiagnosticsContext;

function formatArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.message} ${arg.stack ?? ''}`.trim();
  if (arg !== null && typeof arg === 'object') {
    const sanitized = sanitizeLogContext({ value: arg })['value'];
    return safeStringify(sanitized);
  }
  try {
    return String(arg);
  } catch {
    return '[Unserializable]';
  }
}

export function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? '[Unserializable]' : serialized;
  } catch {
    return '[Unserializable]';
  }
}

/** Build the portable structured record before any renderer-specific sink sees it. */
export function createLogEntry(
  level: LogLevel,
  module: string,
  args: readonly unknown[],
  context?: Record<string, unknown>,
): LogEntry {
  return {
    ts: Date.now(),
    level,
    module,
    message: formatArgs(args),
    ...(context ? { context: sanitizeLogContext(context) } : {}),
  };
}
