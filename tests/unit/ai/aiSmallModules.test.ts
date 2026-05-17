/**
 * Tests for small AI service modules:
 * creativityTemperature, localBackendPresets, modelRecommendations, fetchAdapter.
 * QNBS-v3: Covers 4 previously untested AI helper files in one suite.
 */
import { describe, expect, it, vi } from 'vitest';

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

import { createStoryCraftFetch } from '../../../services/ai/fetchAdapter';

describe('createStoryCraftFetch', () => {
  it('returns a function', () => {
    expect(typeof createStoryCraftFetch()).toBe('function');
  });

  it('falls back to globalThis.fetch in non-Tauri environment', async () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', mockFetch);

    const fetcher = createStoryCraftFetch();
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

    const fetcher = createStoryCraftFetch();
    const res = await fetcher('https://example.com');
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });
});
