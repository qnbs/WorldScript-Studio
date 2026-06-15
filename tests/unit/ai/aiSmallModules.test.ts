/**
 * Tests for small AI service modules:
 * creativityTemperature, localBackendPresets, modelRecommendations, fetchAdapter.
 * QNBS-v3: Covers 4 previously untested AI helper files in one suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// creativityTemperature
// ---------------------------------------------------------------------------

import { CREATIVITY_TO_TEMPERATURE } from '../../../services/ai/creativityTemperature';

describe('CREATIVITY_TO_TEMPERATURE', () => {
  it('maps Focused to 0.2', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Focused).toBe(0.2);
  });

  it('maps Balanced to 0.7', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Balanced).toBe(0.7);
  });

  it('maps Imaginative to 1.0', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Imaginative).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// localBackendPresets
// ---------------------------------------------------------------------------

import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../../services/ai/localBackendPresets';
import {
  RECOMMENDED_OLLAMA_MODEL_IDS,
  RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT,
} from '../../../services/ai/modelRecommendations';

describe('LOCAL_BACKEND_PRESET_DEFAULT_URL', () => {
  it('has an entry for ollama_default pointing to localhost:11434', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.ollama_default).toBe('http://localhost:11434');
  });

  it('has an entry for lm_studio pointing to localhost:1234', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.lm_studio).toBe('http://localhost:1234');
  });

  it('has an entry for vllm', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.vllm).toBe('http://localhost:8000');
  });

  it('has an entry for custom', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.custom).toBeTruthy();
  });
});

describe('RECOMMENDED_OLLAMA_MODEL_IDS', () => {
  it('is a non-empty array', () => {
    expect(RECOMMENDED_OLLAMA_MODEL_IDS.length).toBeGreaterThan(0);
  });

  it('contains llama3.3', () => {
    expect(RECOMMENDED_OLLAMA_MODEL_IDS as readonly string[]).toContain('llama3.3');
  });
});

describe('RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT', () => {
  it('is a non-empty string', () => {
    expect(typeof RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT).toBe('string');
    expect(RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// modelRecommendations (if it exports constants)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// fetchAdapter
// ---------------------------------------------------------------------------

import { createWorldScriptFetch } from '../../../services/ai/fetchAdapter';

describe('createWorldScriptFetch', () => {
  it('returns a function', () => {
    expect(typeof createWorldScriptFetch()).toBe('function');
  });

  it('falls back to globalThis.fetch in non-Tauri environment', async () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', mockFetch);

    const fetcher = createWorldScriptFetch();
    await fetcher('https://example.com/api');

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', undefined);
    vi.unstubAllGlobals();
  });

  it('produces a fetcher that propagates response', async () => {
    const mockResponse = new Response('{"ok":true}', { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mockResponse)),
    );

    const fetcher = createWorldScriptFetch();
    const res = await fetcher('https://example.com');
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });
});

// QNBS-v3: Tauri-Fetch-Branches — vi.resetModules() + dynamischer Import für saubere Cache-Isolation.
describe('fetchAdapter Tauri paths (isolated)', () => {
  afterEach(() => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>)['__TAURI__'];
    vi.unstubAllGlobals();
  });

  it('Tauri detected + plugin-http import succeeds → uses Tauri fetch', async () => {
    const tauriFetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.resetModules();
    vi.doMock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));
    Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true, writable: true });

    const { createWorldScriptFetch: freshCreate } = await import(
      '../../../services/ai/fetchAdapter'
    );
    const fetcher = freshCreate();
    await fetcher('https://api.example.com', undefined);

    expect(tauriFetchMock).toHaveBeenCalledWith('https://api.example.com', undefined);
  });

  it('Tauri detected + plugin-http import fails → falls back to globalThis.fetch', async () => {
    const globalFetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', globalFetchMock);
    vi.resetModules();
    // async factory throws → dynamic import in fetchAdapter.ts throws → caught by try/catch
    vi.doMock('@tauri-apps/plugin-http', async () => {
      throw new Error('@tauri-apps/plugin-http not available');
    });
    Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true, writable: true });

    const { createWorldScriptFetch: freshCreate } = await import(
      '../../../services/ai/fetchAdapter'
    );
    const fetcher = freshCreate();
    await fetcher('https://api.example.com');

    expect(globalFetchMock).toHaveBeenCalled();
  });

  it('cache hit → second call skips Tauri resolution', async () => {
    vi.resetModules();
    const { createWorldScriptFetch: freshCreate } = await import(
      '../../../services/ai/fetchAdapter'
    );
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const fetcher = freshCreate();
    await fetcher('https://a.com'); // first: no Tauri → cachedTauriFetch = null
    await fetcher('https://b.com'); // second: cache hit (null) → globalThis.fetch

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
