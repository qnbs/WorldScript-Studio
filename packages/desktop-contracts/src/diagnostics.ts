// QNBS-v3: keep recursive diagnostics redaction renderer-neutral so every adapter and sink shares one safe boundary.

const SENSITIVE_KEY_RE = /key|token|password|passphrase/i;

function isSensitiveKey(key: string): boolean {
  return (
    SENSITIVE_KEY_RE.test(key) ||
    /(?:^|[_-])[iI][vV](?=[A-Z]|$|[_-])/.test(key) ||
    /(?:^|[a-z])[iI][vV](?:[A-Z]|$)/.test(key) ||
    /initial(?:ization)?[_-]?vector/i.test(key)
  );
}

export function sanitizeDiagnosticsContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeRecord(context, new WeakSet<object>());
}

export function sanitizeDiagnosticsValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

function sanitizeRecord(
  record: Record<string, unknown>,
  activeObjects: WeakSet<object>,
): Record<string, unknown> {
  if (activeObjects.has(record)) return { '[CIRCULAR]': '[REDACTED]' };
  activeObjects.add(record);
  const out: Record<string, unknown> = {};
  try {
    for (const [key] of Object.entries(record)) {
      if (isSensitiveKey(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      try {
        out[key] = sanitizeValue(record[key], activeObjects);
      } catch {
        out[key] = '[Unserializable]';
      }
    }
  } catch {
    return { '[Unserializable]': '[Unserializable]' };
  } finally {
    activeObjects.delete(record);
  }
  return out;
}

function sanitizeValue(value: unknown, activeObjects: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (activeObjects.has(value)) return '[CIRCULAR]';
    activeObjects.add(value);
    try {
      return value.map((item) => sanitizeValue(item, activeObjects));
    } catch {
      return '[Unserializable]';
    } finally {
      activeObjects.delete(value);
    }
  }
  if (value !== null && typeof value === 'object') {
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return '[Unserializable]';
    }
    if (prototype === Object.prototype || prototype === null) {
      return sanitizeRecord(value as Record<string, unknown>, activeObjects);
    }
    return '[Unserializable]';
  }
  return value;
}
