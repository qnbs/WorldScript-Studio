/**
 * Runtime-aware HTTP layer for local inference servers (Ollama, LM Studio, vLLM).
 *
 * QNBS-v3 (#266, ADR-0012): inside the Tauri WebView, browser `fetch` to `http://localhost:*` is
 * cross-origin and dies on CORS/PNA unless the server opts in — so desktop discovery silently saw
 * nothing. Under Tauri we route through `@tauri-apps/plugin-http` (native reqwest stack, no CORS);
 * on the web we keep the global fetch. The plugin is imported dynamically so the web bundle never
 * loads it. Kept deliberately thin: URL normalization, timeout composition, error classification.
 */
import { isTauriRuntime } from './tauriRuntime';

export type LocalServerErrorKind = 'unreachable' | 'timeout';

/** Classified local-server failure. User aborts are NOT wrapped — they rethrow unchanged. */
export class LocalServerError extends Error {
  readonly kind: LocalServerErrorKind;

  constructor(kind: LocalServerErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocalServerError';
    this.kind = kind;
  }
}

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Trims whitespace and trailing slashes; falls back to the Ollama default when empty. */
export function normalizeLocalBaseUrl(
  baseUrl?: string,
  fallback: string = DEFAULT_OLLAMA_BASE_URL,
): string {
  const resolved = baseUrl?.trim() || fallback;
  return resolved.replace(/\/+$/, '');
}

// QNBS-v3: shape-based checks — DOMException is not an instanceof Error in some runtimes.
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
  );
}

export function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'TimeoutError'
  );
}

export interface LocalServerFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Caller cancellation. Abort errors propagate unchanged (cancel ≠ failure). */
  signal?: AbortSignal | null;
  /** Wall-clock timeout merged with `signal` via AbortSignal.any. */
  timeoutMs?: number;
}

/** Picks the native Tauri HTTP plugin on desktop, global fetch on the web. */
async function resolveFetch(): Promise<typeof fetch> {
  if (isTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch as unknown as typeof fetch;
  }
  return globalThis.fetch.bind(globalThis);
}

function composeSignal(signal: AbortSignal | null | undefined, timeoutMs?: number) {
  if (timeoutMs === undefined) return signal ?? null;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  // QNBS-v3: AbortSignal.any ships in Node 22 + all target browsers; fall back to the timeout
  // signal alone if an exotic runtime lacks it (caller cancel then no-ops, never crashes).
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
}

/**
 * fetch() for local servers. Throws LocalServerError('unreachable' | 'timeout') on transport
 * failures; rethrows the original AbortError for caller-initiated cancels; returns the Response
 * otherwise (HTTP status classification stays with the caller).
 */
export async function localServerFetch(
  url: string,
  init: LocalServerFetchInit = {},
): Promise<Response> {
  const fetchImpl = await resolveFetch();
  const requestInit: RequestInit = {
    ...(init.method !== undefined ? { method: init.method } : {}),
    ...(init.headers !== undefined ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: composeSignal(init.signal, init.timeoutMs),
  };
  try {
    return await fetchImpl(url, requestInit);
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (isTimeoutError(err)) {
      throw new LocalServerError('timeout', `Local server timed out (${url})`, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new LocalServerError('unreachable', `Local server not reachable (${url}): ${message}`, {
      cause: err,
    });
  }
}
