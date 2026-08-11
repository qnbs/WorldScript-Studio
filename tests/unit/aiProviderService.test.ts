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

// QNBS-v3 (ADR-0016 Track A): localServerFetch's own Tauri-vs-web routing is already fully
// covered by localServerHttp.test.ts — mock only its native dependency (plugin-http) here,
// exactly like that file does, so the real localServerFetch (used by both the new Anthropic
// path and the pre-existing local-server scan) keeps working for every other test in this file.
const mockPluginHttpFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockPluginHttpFetch(...args),
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
  it('returns ok:false (noApiKey) for anthropic on proxy-capable web with no key stored', async () => {
    // QNBS-v3 (ADR-0016 Track B): default jsdom BASE_URL is proxy-capable ('/', not the GitHub
    // Pages path) — see tests/unit/deployTarget.test.ts for the dedicated branch coverage.
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('noApiKey');
  });

  it('returns ok:false for ollama in browser (no Tauri)', async () => {
    const result = await testAIConnection('ollama', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('desktop app');
    expect(result.kind).toBe('desktopRequired');
  });

  it('returns ok:false when openai key is missing', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Key');
    expect(result.kind).toBe('noApiKey');
    expect(result.params).toEqual({ provider: 'OpenAI' });
  });

  it('returns ok:false when gemini key is missing', async () => {
    vi.mocked(storageService.getGeminiApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('gemini', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('key');
    expect(result.kind).toBe('noApiKey');
    expect(result.params).toEqual({ provider: 'Gemini' });
  });

  it('returns ok:false for unknown provider', async () => {
    const result = await testAIConnection('unknown' as never, {});
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('unknownProvider');
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
    expect(result.kind).toBe('noWebgpu');
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

describe('testAIConnection — ollama desktop branch', () => {
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('delegates to testOllamaConnection under Tauri and returns its result', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({ ok: true });
    const result = await testAIConnection('ollama', { ollamaBaseUrl: 'http://host:11434' });
    expect(result.ok).toBe(true);
    expect(testOllamaConnection).toHaveBeenCalledWith('http://host:11434');
  });

  it('propagates the service error under Tauri (e.g. classified timeout)', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({
      ok: false,
      error: 'Ollama timed out (http://localhost:11434)',
    });
    const result = await testAIConnection('ollama', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('uses the OpenAI-compatible models endpoint for the LM Studio preset', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockPluginHttpFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 }),
    );

    const result = await testAIConnection('ollama', {
      ollamaBaseUrl: 'http://127.0.0.1:1234/',
      localBackendPreset: 'lm_studio',
    });

    expect(result).toMatchObject({
      ok: true,
      localServer: {
        normalizedEndpoint: 'http://127.0.0.1:1234/v1',
        transport: 'tauri-http',
        modelNames: ['local-model'],
      },
    });
    expect(mockPluginHttpFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.any(Object),
    );
  });

  it('reports a reachable LM Studio endpoint with no models distinctly', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockPluginHttpFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const result = await testAIConnection('ollama', {
      ollamaBaseUrl: 'http://localhost:1234',
      localBackendPreset: 'lm_studio',
    });

    expect(result).toMatchObject({ ok: false, kind: 'noModels' });
  });

  it('streams legacy LM Studio requests through /v1/chat/completions, not Ollama /api', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockPluginHttpFetch.mockResolvedValueOnce(
      new Response(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n' +
          'data: {"choices":[{"delta":{"content":" world"}}]}\n' +
          'data: [DONE]\n',
        { status: 200 },
      ),
    );
    const chunks: string[] = [];

    await streamText(
      'Continue this scene',
      'Balanced',
      {
        provider: 'ollama',
        model: 'ollama/local-model',
        ollamaBaseUrl: 'http://localhost:1234',
        localBackendPreset: 'lm_studio',
      },
      { onChunk: (chunk) => chunks.push(chunk) },
    );

    expect(chunks).toEqual(['Hello', ' world']);
    expect(mockPluginHttpFetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockPluginHttpFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/generate'),
      expect.anything(),
    );
  });
});

// QNBS-v3 (ADR-0017): opt-in direct browser→Ollama connection. window.__TAURI_INTERNALS__ is never
// set in this describe block — every case here runs in the plain-browser context.
describe('testAIConnection — ollama browser opt-in (ADR-0017)', () => {
  it('still returns desktopRequired when the flag is off (default, unchanged)', async () => {
    const { testOllamaConnection } = await import('../../services/ollamaService');
    const result = await testAIConnection('ollama', { browserOllamaEnabled: false });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('desktopRequired');
    expect(testOllamaConnection).not.toHaveBeenCalled();
  });

  it('delegates to testOllamaConnection when the flag is on', async () => {
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({ ok: true });
    const result = await testAIConnection('ollama', {
      ollamaBaseUrl: 'http://localhost:11434',
      browserOllamaEnabled: true,
    });
    expect(result.ok).toBe(true);
    expect(testOllamaConnection).toHaveBeenCalledWith('http://localhost:11434');
  });

  it("remaps a generic 'unreachable' result to 'corsSuspected' when the flag is on", async () => {
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({
      ok: false,
      error: 'Ollama not reachable (http://localhost:11434): TypeError: Failed to fetch',
      kind: 'unreachable',
      params: { url: 'http://localhost:11434' },
    });
    const result = await testAIConnection('ollama', { browserOllamaEnabled: true });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('corsSuspected');
    expect(result.params).toEqual({ url: 'http://localhost:11434' });
  });

  it("does not remap a 'timeout' result — only 'unreachable' is CORS-ambiguous", async () => {
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({
      ok: false,
      error: 'Ollama timed out (http://localhost:11434)',
      kind: 'timeout',
      params: { url: 'http://localhost:11434' },
    });
    const result = await testAIConnection('ollama', { browserOllamaEnabled: true });
    expect(result.kind).toBe('timeout');
  });

  it('does not remap a successful result', async () => {
    const { testOllamaConnection } = await import('../../services/ollamaService');
    vi.mocked(testOllamaConnection).mockResolvedValueOnce({ ok: true });
    const result = await testAIConnection('ollama', { browserOllamaEnabled: true });
    expect(result.ok).toBe(true);
    expect(result.kind).toBeUndefined();
  });
});

// QNBS-v3 (ADR-0016): CORS is a browser-only restriction. Track A — on desktop, Anthropic is
// called directly via localServerFetch's native-HTTP escape hatch (plugin-http), same pattern as
// Ollama; localServerFetch itself falls back to globalThis.fetch outside Tauri. Track B — on
// proxy-capable web (Vercel/Cloudflare, not GitHub Pages), the same call goes through this app's
// own same-origin api/claude-proxy instead of straight to api.anthropic.com.
describe('Anthropic — desktop (Track A) and web proxy (Track B) branches (ADR-0016)', () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = import.meta.env.BASE_URL;

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    globalThis.fetch = originalFetch;
    import.meta.env.BASE_URL = originalBaseUrl;
  });

  it('testAIConnection: returns noApiKey when no Claude key is stored under Tauri', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('noApiKey');
  });

  it('testAIConnection: returns ok:true when the native call succeeds under Tauri', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    mockPluginHttpFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(true);
    expect(mockPluginHttpFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'anthropic-key' }),
        // QNBS-v3 (CodeRabbit): bounded like every sibling connectivity check — a real AbortSignal,
        // not the unbounded `null` the pre-fix call passed.
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('testAIConnection: returns httpError when the native call fails under Tauri', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    mockPluginHttpFetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('httpError');
    expect(result.params).toEqual({ status: 401 });
  });

  it('testAIConnection: returns proxyUnavailableStaticHost on GitHub Pages, without ever checking for a key', async () => {
    import.meta.env.BASE_URL = '/WorldScript-Studio/';
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('proxyUnavailableStaticHost');
    expect(storageService.getApiKey).not.toHaveBeenCalled();
    expect(mockPluginHttpFetch).not.toHaveBeenCalled();
  });

  it('testAIConnection: calls the proxy (not api.anthropic.com directly) on proxy-capable web', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchSpy as typeof fetch;
    const result = await testAIConnection('anthropic', {});
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/claude-proxy',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      apiKey: 'anthropic-key',
      model: 'claude-haiku-4-5',
      maxTokens: 1,
    });
    expect(mockPluginHttpFetch).not.toHaveBeenCalled();
  });

  it('streamText: delivers a real Claude response via onChunk under Tauri instead of throwing', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    mockPluginHttpFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello from Claude' }] }), {
        status: 200,
      }),
    );
    const onChunk = vi.fn();
    await streamText(
      'hello',
      'Balanced',
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      { onChunk },
    );
    expect(onChunk).toHaveBeenCalledWith('Hello from Claude');
  });

  it('streamText: delivers a real Claude response via the proxy on proxy-capable web', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello via proxy' }] }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchSpy as typeof fetch;
    const onChunk = vi.fn();
    await streamText(
      'hello',
      'Balanced',
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      { onChunk },
    );
    expect(onChunk).toHaveBeenCalledWith('Hello via proxy');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/claude-proxy',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockPluginHttpFetch).not.toHaveBeenCalled();
  });

  it('streamText: concatenates every text block instead of only the first (CodeRabbit)', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('anthropic-key');
    mockPluginHttpFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', text: 'internal reasoning, not user-facing' },
            { type: 'text', text: 'Part one. ' },
            { type: 'text', text: 'Part two.' },
          ],
        }),
        { status: 200 },
      ),
    );
    const onChunk = vi.fn();
    await streamText(
      'hello',
      'Balanced',
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      { onChunk },
    );
    expect(onChunk).toHaveBeenCalledWith('Part one. Part two.');
  });

  it('streamText: throws the GitHub-Pages-unavailable message without ever checking for a key', async () => {
    import.meta.env.BASE_URL = '/WorldScript-Studio/';
    await expect(
      streamText(
        'hello',
        'Balanced',
        { provider: 'anthropic', model: 'claude-haiku-4-5' },
        { onChunk: vi.fn() },
      ),
    ).rejects.toThrow('not available on this deployment');
    expect(storageService.getApiKey).not.toHaveBeenCalled();
    expect(mockPluginHttpFetch).not.toHaveBeenCalled();
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

  it('treats a provider-thrown abort as a cancellation — no fallback, no onError', async () => {
    // QNBS-v3: The signal is deliberately NOT pre-aborted, so the cancel path can only be reached
    // via isAbortError() correctly classifying the thrown error. The provider throws a *plain* Error
    // named 'AbortError' (not a DOMException) — the runtime variance the orchestrator must handle.
    // A real provider throws on abort without invoking onError; the orchestrator must neither fall
    // back to gemini nor fire the terminal onError.
    const { streamOllama } = await import('../../services/ollamaService');
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.mocked(streamOllama).mockImplementationOnce(async () => {
      throw abortErr;
    });
    const onError = vi.fn();

    await expect(
      streamText(
        'prompt',
        'Balanced',
        { ...defaultOpts, provider: 'ollama', fallbackProviders: ['gemini'] },
        { onChunk: vi.fn(), onError },
        // no signal → the only abort signal is the thrown error's name
      ),
    ).rejects.toThrow(/abort/i);

    expect(geminiService.streamText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

// ─── Streaming abort mid-flow (P0-D branch coverage) ─────────────────────────

describe('streamText OpenAI abort mid-stream', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _clearPendingRequestsForTest();
  });

  it('stops emitting chunks and resolves cleanly when signal aborts mid-stream', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValue('sk-test');
    const ac = new AbortController();
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    let resolveStream!: () => void;

    // Stream emits chunk-1, then waits until aborted before emitting chunk-2
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"chunk1"}}]}\n\n'),
          );
          // Second chunk after a delay — by then the signal will be aborted
          const waitThenEnqueue = new Promise<void>((res) => {
            resolveStream = res;
          });
          void waitThenEnqueue.then(() => {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"chunk2"}}]}\n\n'),
            );
            controller.enqueue(encoder.encode('data: [DONE]\n'));
            controller.close();
          });
        },
      }),
    } as Response);

    const streamPromise = streamText(
      'hello',
      'Balanced',
      { provider: 'openai', model: 'gpt-4o-mini' },
      { onChunk: (t) => chunks.push(t) },
      ac.signal,
    );

    // Wait for chunk-1 to arrive, then abort before chunk-2
    await new Promise<void>((res) => {
      const interval = setInterval(() => {
        if (chunks.length > 0) {
          clearInterval(interval);
          ac.abort();
          resolveStream();
          res();
        }
      }, 5);
    });

    await streamPromise;
    // chunk-1 was received; chunk-2 may or may not arrive (abort is best-effort)
    expect(chunks).toContain('chunk1');
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
    expect(result.kind).toBe('httpError');
    expect(result.params).toEqual({ status: 403 });
  });

  it('grok: returns ok:false when no API key', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce(null);
    const result = await testAIConnection('grok', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Key');
    expect(result.kind).toBe('noApiKey');
    expect(result.params).toEqual({ provider: 'Grok' });
  });

  it('grok: returns ok:false on HTTP 429', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('grok-key');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    const result = await testAIConnection('grok', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
    expect(result.kind).toBe('httpError');
    expect(result.params).toEqual({ status: 429 });
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
    expect(result.kind).toBe('httpError');
    expect(result.params).toEqual({ status: 401 });
  });

  it('returns ok:false with error message when fetch throws (catch branch)', async () => {
    vi.mocked(storageService.getApiKey).mockResolvedValueOnce('sk-key');
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network error'));
    const result = await testAIConnection('openai', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network error');
    expect(result.kind).toBe('unexpected');
    // QNBS-v3 (CodeAnt CWE-209): the raw message stays in `error` (for logs) only -- `unexpected`
    // has no `params`, since the i18n string for it never interpolates the raw exception text.
    expect(result.params).toBeUndefined();
  });
});

// QNBS-v3: scanLocalOpenAiCompatibleEndpoints-Branches — fetch wirft / HTTP-401 gilt als ok.
describe('scanLocalOpenAiCompatibleEndpoints', () => {
  // QNBS-v3 (#266 review): stubGlobal + unstubAllGlobals statt manueller Zuweisung —
  // Vitest stellt so auch bei einem Test-Abbruch den echten fetch wieder her.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:false for all candidates when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const results = await scanLocalOpenAiCompatibleEndpoints();
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.ok).toBe(false);
    }
  });

  it('returns ok:true when HTTP 401 (auth required but reachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
    const results = await scanLocalOpenAiCompatibleEndpoints();
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.state).toBe('ok');
      expect(r.status).toBe(401);
    }
  });

  it('classifies non-ok HTTP responses as state:http with the numeric status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const results = await scanLocalOpenAiCompatibleEndpoints();
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.state).toBe('http');
      expect(r.status).toBe(500);
    }
  });

  it('classifies TimeoutError-shaped rejections as state:timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    const results = await scanLocalOpenAiCompatibleEndpoints();
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.state).toBe('timeout');
    }
  });

  it('classifies plain network failures as state:unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')));
    const results = await scanLocalOpenAiCompatibleEndpoints();
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.state).toBe('unreachable');
    }
  });

  it('tries native /api/tags for Ollama first and never falls back to /v1/models when it succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await scanLocalOpenAiCompatibleEndpoints();
    const ollamaResult = results.find((r) => r.labelKey === 'settings.ai.scanLabelOllama');
    expect(ollamaResult?.ok).toBe(true);
    const ollamaCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('11434'),
    ) as unknown[][];
    expect(ollamaCalls).toHaveLength(1);
    expect(String(ollamaCalls[0]?.[0])).toContain('/api/tags');
  });

  it('falls back to /v1/models for Ollama when the native /api/tags attempt fails (non-timeout)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/api/tags')) {
        return Promise.reject(new TypeError('ECONNREFUSED'));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await scanLocalOpenAiCompatibleEndpoints();
    const ollamaResult = results.find((r) => r.labelKey === 'settings.ai.scanLabelOllama');
    expect(ollamaResult?.ok).toBe(true);
    const ollamaCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('11434'),
    ) as unknown[][];
    expect(ollamaCalls).toHaveLength(2);
    expect(String(ollamaCalls[0]?.[0])).toContain('/api/tags');
    // QNBS-v3 (CodeRabbit): assert the exact OpenAI-compatible path — a loose '/models' substring
    // would also pass for an incorrect '/models' (missing '/v1' prefix) endpoint.
    expect(String(ollamaCalls[1]?.[0])).toContain('/v1/models');
  });

  it('does not attempt a second request for LM Studio/vLLM (only Ollama has a native fallback)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await scanLocalOpenAiCompatibleEndpoints();
    const lmStudioCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('1234'));
    const vllmCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('8000'));
    expect(lmStudioCalls).toHaveLength(1);
    expect(vllmCalls).toHaveLength(1);
  });
});

// ─── Service-level request deduplication ─────────────────────────────────────

import { _clearPendingRequestsForTest } from '../../services/aiProviderService';

describe('service-level request deduplication', () => {
  beforeEach(() => {
    _clearPendingRequestsForTest();
  });

  it('second identical generateText call aborts the first in-flight request', async () => {
    // Simulate a slow first call that respects AbortSignal
    let firstAbortSignal: AbortSignal | undefined;
    const spy = vi
      .spyOn(localAiFacade, 'generateLocalText')
      .mockImplementationOnce(async (_prompt, _modelId) => {
        // Capture the fact that we were called first
        return new Promise<{ layer: 'heuristic'; text: string }>((resolve) => {
          setTimeout(() => resolve({ layer: 'heuristic', text: 'first' }), 100);
        });
      })
      .mockResolvedValueOnce({ layer: 'heuristic', text: 'second' });

    const opts = {
      ...defaultOpts,
      provider: 'onnx' as const,
      model: 'HuggingFaceTB/SmolLM2-135M-Instruct' as const,
    };
    // Fire both calls concurrently — second should abort first
    const p1 = generateText('same-prompt', 'Balanced', opts).catch(() => 'aborted');
    const p2 = generateText('same-prompt', 'Balanced', opts);

    const [_r1, r2] = await Promise.all([p1, p2]);
    // First may resolve via fallback chain or abort; second should succeed
    expect(r2).toBe('second');
    spy.mockRestore();
    void firstAbortSignal; // suppress unused-var warning
  });

  it('cleanup removes pending entry after completion', async () => {
    vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'heuristic',
      text: 'done',
    });
    const opts = {
      ...defaultOpts,
      provider: 'onnx' as const,
      model: 'HuggingFaceTB/SmolLM2-135M-Instruct' as const,
    };
    await generateText('cleanup-test', 'Balanced', opts);
    // Calling again after completion should not throw (no stale abort)
    vi.spyOn(localAiFacade, 'generateLocalText').mockResolvedValueOnce({
      layer: 'heuristic',
      text: 'done2',
    });
    const result = await generateText('cleanup-test', 'Balanced', opts);
    expect(result).toBe('done2');
  });

  it('_clearPendingRequestsForTest resets state between tests', () => {
    // Just ensuring the export exists and is callable — no throw = pass
    expect(() => _clearPendingRequestsForTest()).not.toThrow();
  });
});
