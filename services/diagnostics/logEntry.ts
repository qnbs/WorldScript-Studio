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

function isSensitiveKey(key: string): boolean {
  // QNBS-v3: classify IV spellings as secrets so encryption metadata never crosses the log boundary.
  return (
    SENSITIVE_KEY_RE.test(key) ||
    /(?:^|[_-])iv(?=[A-Z]|$|[_-])/i.test(key) ||
    /(?:^|[a-z])iv(?:[A-Z]|$)/i.test(key) ||
    /initial(?:ization)?[_-]?vector/i.test(key)
  );
}

export function sanitizeLogContext(ctx: Record<string, unknown>): Record<string, unknown> {
  // QNBS-v3: recursively copy JSON-like values so nested secrets are redacted without mutating callers.
  return sanitizeRecord(ctx, new WeakSet<object>());
}

function sanitizeRecord(
  record: Record<string, unknown>,
  activeObjects: WeakSet<object>,
): Record<string, unknown> {
  if (activeObjects.has(record)) return { '[CIRCULAR]': '[REDACTED]' };
  activeObjects.add(record);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(value, activeObjects);
  }
  activeObjects.delete(record);
  return out;
}

function sanitizeValue(value: unknown, activeObjects: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (activeObjects.has(value)) return '[CIRCULAR]';
    activeObjects.add(value);
    const sanitized = value.map((item) => sanitizeValue(item, activeObjects));
    activeObjects.delete(value);
    return sanitized;
  }
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return sanitizeRecord(value as Record<string, unknown>, activeObjects);
    }
    return '[Unserializable]';
  }
  return value;
}

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
