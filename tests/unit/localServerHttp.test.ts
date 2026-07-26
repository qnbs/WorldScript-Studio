import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetchMock = vi.fn();

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

const isTauriRuntimeMock = vi.fn(() => false);
vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => isTauriRuntimeMock(),
}));

import {
  DEFAULT_OLLAMA_BASE_URL,
  LocalServerError,
  localServerFetch,
  normalizeLocalBaseUrl,
} from '../../services/localServerHttp';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  tauriFetchMock.mockReset();
  isTauriRuntimeMock.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── normalizeLocalBaseUrl ────────────────────────────────────────────────────

describe('normalizeLocalBaseUrl', () => {
  it('falls back to the Ollama default for empty/undefined input', () => {
    expect(normalizeLocalBaseUrl()).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(normalizeLocalBaseUrl('   ')).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeLocalBaseUrl('  http://myhost:1234//  ')).toBe('http://myhost:1234');
  });
});

// ─── web branch ───────────────────────────────────────────────────────────────

describe('localServerFetch (web branch)', () => {
  it('uses the global fetch and forwards method/headers/body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await localServerFetch('http://localhost:11434/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"a":1}',
      }),
    );
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it('omits unset init keys (exactOptionalPropertyTypes hygiene)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await localServerFetch('http://localhost:11434/api/tags');
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect('method' in init).toBe(false);
    expect('headers' in init).toBe(false);
    expect('body' in init).toBe(false);
  });

  it('always provides a signal when timeoutMs is set', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await localServerFetch('http://localhost:11434/api/tags', { timeoutMs: 1000 });
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ─── tauri branch ─────────────────────────────────────────────────────────────

describe('localServerFetch (tauri branch)', () => {
  it('uses @tauri-apps/plugin-http instead of the global fetch', async () => {
    isTauriRuntimeMock.mockReturnValue(true);
    tauriFetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await localServerFetch('http://localhost:11434/api/tags', { timeoutMs: 5000 });
    expect(tauriFetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── error classification ─────────────────────────────────────────────────────

describe('localServerFetch error classification', () => {
  it('wraps network failures as LocalServerError(unreachable) with url + cause message', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Connection refused'));
    const err = await localServerFetch('http://localhost:11434/api/tags').catch((e) => e);
    expect(err).toBeInstanceOf(LocalServerError);
    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain('localhost:11434');
    expect(err.message).toContain('Connection refused');
  });

  it('wraps TimeoutError-shaped rejections as LocalServerError(timeout)', async () => {
    const timeoutErr = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.mocked(fetch).mockRejectedValueOnce(timeoutErr);
    const err = await localServerFetch('http://localhost:11434/api/tags').catch((e) => e);
    expect(err).toBeInstanceOf(LocalServerError);
    expect(err.kind).toBe('timeout');
  });

  it('rethrows caller AbortError unchanged (cancel is not a failure)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.mocked(fetch).mockRejectedValueOnce(abortErr);
    const err = await localServerFetch('http://localhost:11434/api/tags').catch((e) => e);
    expect(err).toBe(abortErr);
  });
});
