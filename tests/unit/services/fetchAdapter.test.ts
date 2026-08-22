/**
 * Tests for services/ai/fetchAdapter.ts
 * QNBS-v3: createWorldScriptFetch — uses browser globalThis.fetch when not in Tauri.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('createWorldScriptFetch', () => {
  beforeEach(() => {
    // Ensure no __TAURI__ context
    delete (window as unknown as Record<string, unknown>)['__TAURI__'];
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    // Simulate a runtime where AbortSignal exists but the static timeout helper does not.
    try {
      Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
      const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
      await createWorldScriptFetch({ timeoutMs: 1000 })('https://api.example.com/tags');
      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      if (timeoutDescriptor) Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      else delete (AbortSignal as { timeout?: unknown }).timeout;
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
    // QNBS-v3 (#459): keep the request pending so caller abort is verified as an observable rejection.
    const mockFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      }),
    );
    vi.stubGlobal('fetch', mockFetch);
    const caller = new AbortController();

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    const request = createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags', {
      signal: caller.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const signal = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    caller.abort();
    expect(signal?.aborted).toBe(true);
    await rejection;
  });

  it('uses the manual controller when AbortSignal.any is unavailable', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const caller = new AbortController();
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');

    try {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
      const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
      await createWorldScriptFetch({ timeoutMs: 5000 })('https://api.example.com/tags', {
        signal: caller.signal,
      });

      const signal = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      caller.abort();
      expect(signal?.aborted).toBe(true);
    } finally {
      if (anyDescriptor) Object.defineProperty(AbortSignal, 'any', anyDescriptor);
      else delete (AbortSignal as { any?: unknown }).any;
    }
  });

  it('does not attach a signal for a non-positive timeout', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { createWorldScriptFetch } = await import('../../../services/ai/fetchAdapter');
    await createWorldScriptFetch({ timeoutMs: 0 })('https://api.example.com/tags');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
  });
});
