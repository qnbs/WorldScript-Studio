/**
 * Tests for services/ai/fetchAdapter.ts
 * QNBS-v3: createWorldScriptFetch — uses browser globalThis.fetch when not in Tauri.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('createWorldScriptFetch', () => {
  beforeEach(() => {
    // Ensure no __TAURI__ context
    delete (window as unknown as Record<string, unknown>)['__TAURI__'];
    vi.resetModules();
  });

  it('uses globalThis.fetch when not in Tauri environment', async () => {
    const mockResponse = new Response('{"ok":true}', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    const fetchFn = createWorldScriptFetch();
    const result = await fetchFn('https://api.example.com/test');

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test', undefined);
    expect(result).toBe(mockResponse);
    vi.unstubAllGlobals();
  });

  it('passes init options to the underlying fetch', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    const fetchFn = createWorldScriptFetch();
    const init = { method: 'POST', body: JSON.stringify({ test: true }) };
    await fetchFn('https://api.example.com/test', init);

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test', init);
    vi.unstubAllGlobals();
  });

  it('returns a callable function', async () => {
    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    const fetchFn = createWorldScriptFetch();
    expect(typeof fetchFn).toBe('function');
  });

  it('does not attach a signal when no timeout is configured (streaming-safe default)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    await createWorldScriptFetch()('https://api.example.com/stream', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/stream', { method: 'POST' });
    vi.unstubAllGlobals();
  });

  it('attaches an AbortSignal when an opt-in timeout is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    await createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags');

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllGlobals();
  });

  it('falls back to AbortController when AbortSignal.timeout is unavailable', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const originalTimeout = AbortSignal.timeout;
    // Simulate a runtime where AbortSignal exists but the static timeout helper does not.
    (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
    try {
      const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
      await createWorldScriptFetch({ timeoutMs: 1000 })('https://api.example.com/tags');
      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      (AbortSignal as unknown as { timeout: typeof originalTimeout }).timeout = originalTimeout;
      vi.unstubAllGlobals();
    }
  });

  it('composes the timeout with a caller-provided signal', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    const caller = new AbortController();
    await createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags', {
      signal: caller.signal,
    });

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    vi.unstubAllGlobals();
  });

  it('propagates caller aborts through the composed timeout signal', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const caller = new AbortController();

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    await createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags', {
      signal: caller.signal,
    });

    const signal = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(signal?.aborted).toBe(false);
    caller.abort();
    expect(signal?.aborted).toBe(true);
    vi.unstubAllGlobals();
  });

  it('uses the manual controller when AbortSignal.any is unavailable', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const caller = new AbortController();
    const originalAny = AbortSignal.any;
    (AbortSignal as unknown as { any?: typeof AbortSignal.any }).any = undefined;

    try {
      const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
      await createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags', {
        signal: caller.signal,
      });

      const signal = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      caller.abort();
      expect(signal?.aborted).toBe(true);
    } finally {
      (AbortSignal as unknown as { any: typeof originalAny }).any = originalAny;
      vi.unstubAllGlobals();
    }
  });

  it('does not attach a signal for a non-positive timeout', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    await createWorldScriptFetch({ timeoutMs: 0 })('https://api.example.com/tags');

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/tags', undefined);
    vi.unstubAllGlobals();
  });
});
