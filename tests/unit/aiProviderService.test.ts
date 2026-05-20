import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../services/storageService', () => ({
  storageService: {
    getApiKey: vi.fn(),
    getGeminiApiKey: vi.fn(),
    loadSettings: vi.fn(),
  },
}));

vi.mock('@domain/ai-core', async () => {
  const actual = await vi.importActual<typeof import('@domain/ai-core')>('@domain/ai-core');
  return {
    ...actual,
    detectWebGpuSupport: vi.fn(() => true),
  };
});

vi.mock('../../services/geminiService', () => ({
  generateText: vi.fn(),
  generateJson: vi.fn(),
  generateImage: vi.fn(),
  streamText: vi.fn(),
  streamAiHelpResponse: vi.fn(),
}));

vi.mock('../../services/ollamaService', () => ({
  streamOllama: vi.fn(),
  listOllamaModels: vi.fn().mockResolvedValue(['llama3']),
  testOllamaConnection: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  generateImage,
  generateJson,
  generateText,
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  streamText,
  testAIConnection,
} from '../../services/aiProviderService';
import * as geminiService from '../../services/geminiService';
import * as localAiFacade from '../../services/localAiFacade';
import { storageService } from '../../services/storageService';

const defaultOpts = { provider: 'gemini' as const, model: 'gemini-2.5-flash' as const };

beforeEach(() => {
  vi.clearAllMocks();
  // Remove __TAURI__ so ollama tests see browser context
  delete (window as { __TAURI__?: unknown }).__TAURI__;
  vi.mocked(storageService.loadSettings).mockResolvedValue({
    privacy: {
      localStorageOnly: false,
      euDataResidency: false,
    },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── generateImage ────────────────────────────────────────────────────────────

describe('generateImage', () => {
  it('delegates to geminiService for gemini provider', async () => {
    vi.mocked(geminiService.generateImage).mockResolvedValueOnce('data:image/png;base64,abc');
    const result = await generateImage('a cat', defaultOpts);
    expect(result).toBe('data:image/png;base64,abc');
    expect(geminiService.generateImage).toHaveBeenCalledWith('a cat', undefined);
  });

  it('throws for openai provider', async () => {
    await expect(generateImage('a cat', { ...defaultOpts, provider: 'openai' })).rejects.toThrow(
      'not available via the browser',
    );
  });

  it('throws for ollama provider', async () => {
    await expect(generateImage('a cat', { ...defaultOpts, provider: 'ollama' })).rejects.toThrow(
      'not supported',
    );
  });

  it('throws for anthropic provider', async () => {
    await expect(generateImage('a cat', { ...defaultOpts, provider: 'anthropic' })).rejects.toThrow(
      'not available',
    );
  });

  it('throws for webllm provider', async () => {
    await expect(generateImage('a cat', { ...defaultOpts, provider: 'webllm' })).rejects.toThrow(
      'Local inference is text-only',
    );
  });

  it('throws for onnx provider', async () => {
    await expect(generateImage('a cat', { ...defaultOpts, provider: 'onnx' })).rejects.toThrow(
      'Local inference is text-only',
    );
  });

  it('throws for transformers provider', async () => {
    await expect(
      generateImage('a cat', { ...defaultOpts, provider: 'transformers' }),
    ).rejects.toThrow('Local inference is text-only');
  });
});

// ─── generateText ─────────────────────────────────────────────────────────────

describe('generateText', () => {
  it('delegates to geminiService for gemini provider', async () => {
    vi.mocked(geminiService.generateText).mockResolvedValueOnce('result text');
    const text = await generateText('prompt', 'Balanced', defaultOpts);
    expect(text).toBe('result text');
  });

  it('passes standalone AbortSignal to ollama stream', async () => {
    const { streamOllama } = await import('../../services/ollamaService');
    const ac = new AbortController();
    vi.mocked(streamOllama).mockImplementationOnce(async (_p, o, cb) => {
      expect(o.signal).toBe(ac.signal);
      cb.onChunk('ok');
    });
    const text = await generateText(
      'prompt',
      'Balanced',
      { ...defaultOpts, provider: 'ollama' },
      ac.signal,
    );
    expect(text).toBe('ok');
  });

  it('falls back to local AI when anthropic is unavailable', async () => {
    const spy = vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'heuristic',
      text: 'local-fallback-text',
    });
    const text = await generateText('prompt', 'Balanced', {
      ...defaultOpts,
      provider: 'anthropic',
    });
    expect(text).toBe('local-fallback-text');
    spy.mockRestore();
  });

  it('delegates to local facade for webllm provider', async () => {
    const spy = vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'webllm',
      text: 'browser-local-text',
    });
    const text = await generateText('hello', 'Balanced', {
      ...defaultOpts,
      provider: 'webllm',
      model: 'webllm/browser',
    });
    expect(text).toBe('browser-local-text');
    spy.mockRestore();
  });

  it('delegates to local facade for onnx provider, passing model id', async () => {
    const spy = vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'onnx',
      text: 'onnx-text',
    });
    const modelId = 'HuggingFaceTB/SmolLM2-135M-Instruct';
    const text = await generateText('hello', 'Balanced', {
      ...defaultOpts,
      provider: 'onnx',
      model: modelId,
    });
    expect(text).toBe('onnx-text');
    expect(spy).toHaveBeenCalledWith(expect.any(String), modelId);
    spy.mockRestore();
  });

  it('delegates to local facade for transformers provider, passing model id', async () => {
    const spy = vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'transformers',
      text: 'transformers-text',
    });
    const modelId = 'Xenova/distilgpt2';
    const text = await generateText('hello', 'Balanced', {
      ...defaultOpts,
      provider: 'transformers',
      model: modelId,
    });
    expect(text).toBe('transformers-text');
    expect(spy).toHaveBeenCalledWith(expect.any(String), modelId);
    spy.mockRestore();
  });
});

// ─── generateJson ─────────────────────────────────────────────────────────────

describe('generateJson', () => {
  it('delegates to geminiService for gemini provider', async () => {
    const schema = { type: 'object' as const, properties: {} };
    vi.mocked(geminiService.generateJson).mockResolvedValueOnce({ key: 'val' });
    const result = await generateJson('prompt', 'Balanced', schema as never, defaultOpts);
    expect(result).toEqual({ key: 'val' });
  });

  it('parses JSON text for non-gemini providers (ollama)', async () => {
    const { streamOllama } = await import('../../services/ollamaService');
    vi.mocked(streamOllama).mockImplementationOnce(async (_p, _o, cb) => {
      cb.onChunk('["a","b"]');
    });
    const schema = { type: 'array' as const };
    const result = await generateJson<string[]>('prompt', 'Balanced', schema as never, {
      ...defaultOpts,
      provider: 'ollama',
    });
    expect(result).toEqual(['a', 'b']);
  });

  it('throws on invalid JSON from non-gemini provider (ollama)', async () => {
    const { streamOllama } = await import('../../services/ollamaService');
    vi.mocked(streamOllama).mockImplementationOnce(async (_p, _o, cb) => {
      cb.onChunk('not-json');
    });
    await expect(
      generateJson('prompt', 'Balanced', {} as never, { ...defaultOpts, provider: 'ollama' }),
    ).rejects.toThrow('not valid JSON');
  });
});

// ─── testAIConnection ─────────────────────────────────────────────────────────

describe('testAIConnection', () => {
  it('returns ok:false for anthropic (CORS restriction)', async () => {
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('CORS');
  });

  it('returns ok:false for ollama in browser (no Tauri)', async () => {
    const result = await testAIConnection('ollama', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('desktop app');
  });

  it('returns ok:false when openai key is missing', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Key');
  });

  it('returns ok:false when gemini key is missing', async () => {
    vi.mocked(storageService.getGeminiApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('gemini', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('key');
  });

  it('returns ok:false for unknown provider', async () => {
    const result = await testAIConnection('unknown' as never, {});
    expect(result.ok).toBe(false);
  });

  it('returns ok:true for webllm when WebGPU is available', async () => {
    const result = await testAIConnection('webllm', {});
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for webllm without WebGPU', async () => {
    const aiCore = await import('@domain/ai-core');
    vi.spyOn(aiCore, 'detectWebGpuSupport').mockReturnValueOnce(false);
    const result = await testAIConnection('webllm', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('WebGPU');
  });

  it('returns ok:true for onnx (WASM always available)', async () => {
    const result = await testAIConnection('onnx', {});
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for transformers (WASM always available)', async () => {
    const result = await testAIConnection('transformers', {});
    expect(result.ok).toBe(true);
  });
});

// ─── streamText (OpenAI signal + Ollama→Gemini fallback) ────────────────────

describe('streamText OpenAI', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('forwards merged AbortSignal to OpenAI fetch', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-test');
    const ac = new AbortController();
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"z"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n'));
          controller.close();
        },
      }),
    } as Response);

    const chunks: string[] = [];
    await streamText(
      'hello',
      'Balanced',
      { provider: 'openai', model: 'gpt-4o-mini' },
      { onChunk: (t) => chunks.push(t) },
      ac.signal,
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ signal: ac.signal }),
    );
    expect(chunks.join('')).toContain('z');
  });
});

describe('streamText ollama→gemini fallback', () => {
  it('falls back to gemini when ollama fails and fallbackProviders includes gemini', async () => {
    const { streamOllama } = await import('../../services/ollamaService');
    vi.mocked(streamOllama).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(geminiService.streamText).mockResolvedValueOnce(undefined);

    const onChunk = vi.fn();
    await streamText(
      'prompt',
      'Balanced',
      { ...defaultOpts, provider: 'ollama', fallbackProviders: ['gemini'] },
      { onChunk },
    );

    expect(geminiService.streamText).toHaveBeenCalled();
  });

  it('throws when ollama fails and no fallback configured', async () => {
    const { streamOllama } = await import('../../services/ollamaService');
    vi.mocked(streamOllama).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      streamText(
        'prompt',
        'Balanced',
        { ...defaultOpts, provider: 'ollama' },
        { onChunk: vi.fn() },
      ),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

// ─── listOllamaModels ────────────────────────────────────────────────────────

describe('listOllamaModels', () => {
  it('delegates to ollamaService', async () => {
    const result = await listOllamaModels('http://localhost:11434');
    expect(result).toEqual(['llama3']);
  });
});

// QNBS-v3: streamOpenAI-Fehler-Branches — HTTP-Fehler, null-Body, aborted-Signal.
describe('streamOpenAI error paths', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws on non-ok HTTP response (429)', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-test');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: { message: 'rate limited' } }),
    } as unknown as Response);

    await expect(
      streamText(
        'hello',
        'Balanced',
        { provider: 'openai', model: 'gpt-4o-mini' },
        { onChunk: vi.fn() },
      ),
    ).rejects.toThrow('OpenAI API Error 429');
  });

  it('throws when response body is null', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-test');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
    } as unknown as Response);

    await expect(
      streamText(
        'hello',
        'Balanced',
        { provider: 'openai', model: 'gpt-4o-mini' },
        { onChunk: vi.fn() },
      ),
    ).rejects.toThrow('No response body');
  });

  it('breaks without emitting chunks when signal is already aborted', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-test');
    const ac = new AbortController();
    ac.abort();
    const onChunk = vi.fn();
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"X"}}]}\n\n'));
          controller.close();
        },
      }),
    } as unknown as Response);

    await streamText(
      'hello',
      'Balanced',
      { provider: 'openai', model: 'gpt-4o-mini' },
      { onChunk },
      ac.signal,
    );
    // aborted → loop breaks before reading; onChunk never called
    expect(onChunk).not.toHaveBeenCalled();
  });
});

// QNBS-v3: streamGrok-Fehler-Branch — !res.ok wirft API-Fehler.
describe('streamGrok error paths', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws on non-ok HTTP response from Grok', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('grok-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as unknown as Response);

    await expect(
      streamText(
        'hello',
        'Balanced',
        { provider: 'grok', model: 'grok-3-mini' },
        { onChunk: vi.fn() },
      ),
    ).rejects.toThrow('Grok API Error 503');
  });
});

// QNBS-v3: testAIConnection-Branches — HTTP-Fehler, grok kein Key, gemini HTTP-Fehler, catch.
describe('testAIConnection additional branches', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('openai: returns ok:true on HTTP 200', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(true);
  });

  it('openai: returns ok:false on HTTP 403', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('403');
  });

  it('grok: returns ok:false when no API key', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('grok', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Key');
  });

  it('grok: returns ok:false on HTTP 429', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('grok-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    const result = await testAIConnection('grok', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
  });

  it('gemini: returns ok:true on HTTP 200', async () => {
    vi.mocked(storageService.getGeminiApiKey).mockResolvedValueOnce('gemini-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const result = await testAIConnection('gemini', {});
    expect(result.ok).toBe(true);
  });

  it('gemini: returns ok:false on HTTP 401', async () => {
    vi.mocked(storageService.getGeminiApiKey).mockResolvedValueOnce('gemini-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    const result = await testAIConnection('gemini', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('returns ok:false with error message when fetch throws (catch branch)', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-key');
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network error'));
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network error');
  });
});

// QNBS-v3: scanLocalOpenAiCompatibleEndpoints-Branches — fetch wirft / HTTP-401 gilt als ok.
describe('scanLocalOpenAiCompatibleEndpoints', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok:false for all candidates when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const results = await scanLocalOpenAiCompatibleEndpoints();
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.ok).toBe(false);
    }
  });

  it('returns ok:true when HTTP 401 (auth required but reachable)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    const results = await scanLocalOpenAiCompatibleEndpoints();
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.status).toBe(401);
    }
  });
});
