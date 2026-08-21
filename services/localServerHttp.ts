/**
 * Runtime-aware HTTP layer for local inference servers (Ollama, LM Studio, vLLM).
 *
 * QNBS-v3 (#266, ADR-0012): inside the Tauri WebView, browser `fetch` to `http://localhost:*` is
 * cross-origin and dies on CORS/PNA unless the server opts in — so desktop discovery silently saw
 * nothing. Under Tauri we route through `@tauri-apps/plugin-http` (native reqwest stack, no CORS);
 * on the web we keep the global fetch. The plugin is imported dynamically so the web bundle never
 * loads it. Kept deliberately thin: URL normalization, timeout composition, error classification.
 *
 * QNBS-v3 (ADR-0017): the opt-in `enableBrowserOllama` flag does NOT change anything in this file
 * — `resolveFetch()` already returns `globalThis.fetch` on the web unconditionally, which already
 * attempts the real request; the browser's own CORS enforcement (not this module) is what actually
 * decides success or failure, based on whether the user configured their Ollama server's
 * `OLLAMA_ORIGINS`. The flag only widens the *product-level* decision to attempt the call at all —
 * see the call sites in `aiProviderService.ts`'s `testAIConnection` and
 * `components/settings/AiProviderCard.tsx` — not the transport layer.
 */
import { createLogger } from './logger';
import { assertCspConnectEndpointAllowed } from './network/cspOriginPolicy';
import { isTauriRuntime } from './tauriRuntime';

const log = createLogger('localServerHttp');

export type LocalServerErrorKind = 'unreachable' | 'timeout' | 'plugin_unavailable';

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

/**
 * Picks the native Tauri HTTP plugin on desktop, global fetch on the web.
 *
 * QNBS-v3: the dynamic import can fail at runtime even when `isTauriRuntime()` is true — a build
 * config regression that externalizes `@tauri-apps/*` leaves this as an unresolvable bare
 * specifier in the packaged app. That failure must NOT be swallowed into the generic
 * 'unreachable' classification (indistinguishable from a genuinely-down server); it's a plugin
 * load failure, not a network failure, and is far more actionable to surface distinctly. No
 * `globalThis.fetch` fallback here (unlike services/ai/fetchAdapter.ts's cloud-provider path) —
 * it wouldn't help localhost targets, which fail on CORS in the WebView regardless.
 */
async function resolveFetch(): Promise<typeof fetch> {
  if (isTauriRuntime()) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      return tauriFetch as unknown as typeof fetch;
    } catch (err) {
      log.error('Tauri HTTP plugin failed to load; local server requests cannot proceed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new LocalServerError(
        'plugin_unavailable',
        'Local server networking is unavailable: the desktop HTTP plugin failed to load.',
        { cause: err },
      );
    }
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
  // QNBS-v3: browser-local inference must fail clearly before CSP turns the request into a generic network error.
  if (!isTauriRuntime()) assertCspConnectEndpointAllowed(url, 'Local server endpoint');
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
