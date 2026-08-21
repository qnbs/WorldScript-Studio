// QNBS-v3: Keep log construction and redaction renderer-neutral for future Core authority work.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

const SENSITIVE_KEY_RE = /key|token|password|passphrase/i;

export function sanitizeLogContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

function formatArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}`.trim() : String(arg)))
    .join(' ');
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
