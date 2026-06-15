/**
 * Tests for services/ai/orchestrationProviders.ts and fetchAdapter.ts
 * QNBS-v3: Pure logic + fetch adapter fallback behavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// orchestrationProviders
// ---------------------------------------------------------------------------

import {
  isLocalInferenceProvider,
  isOrchestrationReadyProvider,
  ORCHESTRATION_READY_PROVIDERS,
} from '../../services/ai/orchestrationProviders';

describe('isOrchestrationReadyProvider', () => {
  it('returns true for gemini', () => {
    expect(isOrchestrationReadyProvider('gemini')).toBe(true);
  });

  it('returns true for openai', () => {
    expect(isOrchestrationReadyProvider('openai')).toBe(true);
  });

  it('returns true for ollama', () => {
    expect(isOrchestrationReadyProvider('ollama')).toBe(true);
  });

  it('returns false for webllm', () => {
    expect(isOrchestrationReadyProvider('webllm')).toBe(false);
  });

  it('returns false for onnx', () => {
    expect(isOrchestrationReadyProvider('onnx')).toBe(false);
  });

  it('ORCHESTRATION_READY_PROVIDERS contains exactly gemini, openai, ollama', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('gemini');
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('openai');
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('ollama');
  });
});

describe('isLocalInferenceProvider', () => {
  it('returns true for webllm', () => {
    expect(isLocalInferenceProvider('webllm')).toBe(true);
  });

  it('returns true for onnx', () => {
    expect(isLocalInferenceProvider('onnx')).toBe(true);
  });

  it('returns true for transformers', () => {
    expect(isLocalInferenceProvider('transformers')).toBe(true);
  });

  it('returns false for gemini', () => {
    expect(isLocalInferenceProvider('gemini')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchAdapter — createWorldScriptFetch
// ---------------------------------------------------------------------------

describe('createWorldScriptFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses globalThis.fetch when not in Tauri runtime', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('window', {});

    const { createWorldScriptFetch } = await import('../../services/ai/fetchAdapter');
    const fetchFn = createWorldScriptFetch();
    await fetchFn('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith('https://example.com', undefined);
  });
});
