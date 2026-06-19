import { isTauriRuntime } from '../tauriRuntime';

type TauriHttpFetch = typeof globalThis.fetch;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedTauriFetch: TauriHttpFetch | null | undefined;

async function resolveTauriFetch(): Promise<TauriHttpFetch | undefined> {
  if (cachedTauriFetch !== undefined) return cachedTauriFetch ?? undefined;
  // QNBS-v3 (T0): canonical detection — `window.__TAURI__` alone was false in the real shell, so
  // desktop AI calls never used the native HTTP client (CORS bypass) and silently hit the WebView.
  if (!isTauriRuntime()) {
    cachedTauriFetch = null;
    return undefined;
  }
  try {
    const mod = await import('@tauri-apps/plugin-http');
    cachedTauriFetch = mod.fetch;
    return mod.fetch;
  } catch {
    cachedTauriFetch = null;
    return undefined;
  }
}

export interface WorldScriptFetchOptions {
  /**
   * QNBS-v3: P1-F6 — opt-in request timeout (ms). DEFAULT OFF: streaming AI calls must not be
   * aborted mid-stream, so the timeout is only applied when a caller explicitly sets it (use for
   * short, non-streaming requests like `/api/tags` health probes). Composed with any caller signal.
   */
  timeoutMs?: number;
}

/**
 * Build an abort signal that fires after `timeoutMs`, merged with an optional caller signal.
 * QNBS-v3: prefers native `AbortSignal.timeout` (+ `AbortSignal.any` to merge), and falls back to
 * a manual `AbortController` + `setTimeout` so the timeout still applies in runtimes lacking those
 * static helpers (and when a caller signal is present but `AbortSignal.any` is not).
 */
function buildTimeoutSignal(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  const hasNativeTimeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
  const hasAny = typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function';

  if (hasNativeTimeout && (!callerSignal || hasAny)) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  }

  if (typeof AbortController === 'undefined') {
    // No way to synthesize a timeout signal — leave the request untouched rather than break it.
    return callerSignal;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  // Clear the timer once aborted (by timeout or by the caller) to avoid a dangling handle.
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

/**
 * Fetch für AI-Provider: im **Tauri-Desktop** Rust-HTTP-Client (CORS-Umgehung für lokale LLMs),
 * sonst Browser-`fetch`. Schlägt das Plugin fehl → Fallback auf `globalThis.fetch`.
 *
 * QNBS-v3: `options.timeoutMs` is opt-in (see {@link WorldScriptFetchOptions}); without it the
 * returned fetch is behaviourally identical to a bare `fetch`, so existing streaming callers are
 * unaffected. When set, the timeout applies consistently via {@link buildTimeoutSignal}.
 */
export function createWorldScriptFetch(options?: WorldScriptFetchOptions): FetchLike {
  const timeoutMs = options?.timeoutMs;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const tauriFetch = await resolveTauriFetch();
    const impl = tauriFetch ?? globalThis.fetch;

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      const signal = buildTimeoutSignal(timeoutMs, init?.signal ?? undefined);
      if (signal) return impl(input, { ...init, signal });
    }

    return impl(input, init);
  };
}
