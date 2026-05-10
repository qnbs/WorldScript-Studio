type TauriHttpFetch = typeof globalThis.fetch;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedTauriFetch: TauriHttpFetch | null | undefined;

async function resolveTauriFetch(): Promise<TauriHttpFetch | undefined> {
  if (cachedTauriFetch !== undefined) return cachedTauriFetch ?? undefined;
  if (typeof window === 'undefined' || !window.__TAURI__) {
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

/**
 * Fetch für AI-Provider: im **Tauri-Desktop** Rust-HTTP-Client (CORS-Umgehung für lokale LLMs),
 * sonst Browser-`fetch`. Schlägt das Plugin fehl → Fallback auf `globalThis.fetch`.
 */
export function createStoryCraftFetch(): FetchLike {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const tauriFetch = await resolveTauriFetch();
    const impl = tauriFetch ?? globalThis.fetch;
    return impl(input, init);
  };
}
