import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeOllamaModelId,
  normalizeOpenAiCompatibleBaseUrl,
} from '../../services/ai/modelNormalization';
import { isOrchestrationReadyProvider } from '../../services/ai/orchestrationProviders';

describe('worldScriptAi provider helpers', () => {
  it('normalizes Ollama base URL to include /v1', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:11434')).toBe(
      'http://localhost:11434/v1',
    );
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:11434/')).toBe(
      'http://localhost:11434/v1',
    );
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1',
    );
    expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:1234')).toBe(
      'http://127.0.0.1:1234/v1',
    );
  });

  it('strips ollama/ prefix from stored model ids', () => {
    expect(normalizeOllamaModelId('ollama/qwen3:8b')).toBe('qwen3:8b');
    expect(normalizeOllamaModelId('gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('flags orchestration-ready providers', () => {
    expect(isOrchestrationReadyProvider('gemini')).toBe(true);
    expect(isOrchestrationReadyProvider('openai')).toBe(true);
    expect(isOrchestrationReadyProvider('ollama')).toBe(true);
    expect(isOrchestrationReadyProvider('grok')).toBe(false);
    expect(isOrchestrationReadyProvider('anthropic')).toBe(false);
    expect(isOrchestrationReadyProvider('webllm')).toBe(false);
  });
});

describe('createWorldScriptFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
  });

  it('uses global fetch when not under Tauri', async () => {
    const prev = (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;

    const { createWorldScriptFetch } = await import('../../services/ai/fetchAdapter');
    const f = createWorldScriptFetch();
    await f('https://example.com', { method: 'GET' });
    expect(globalThis.fetch).toHaveBeenCalled();

    if (prev !== undefined) {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = prev;
    }
  });
});
