import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../services/storageService', () => ({
  storageService: {
    getApiKey: vi.fn(),
    getGeminiApiKey: vi.fn(),
  },
}));

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
  streamText,
  testAIConnection,
} from '../../services/aiProviderService';
import * as geminiService from '../../services/geminiService';
import { storageService } from '../../services/storageService';

const defaultOpts = { provider: 'gemini' as const, model: 'gemini-1.5-flash' as const };

beforeEach(() => {
  vi.clearAllMocks();
  // Remove __TAURI__ so ollama tests see browser context
  delete (window as { __TAURI__?: unknown }).__TAURI__;
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
});

// ─── generateText ─────────────────────────────────────────────────────────────

describe('generateText', () => {
  it('delegates to geminiService for gemini provider', async () => {
    vi.mocked(geminiService.generateText).mockResolvedValueOnce('result text');
    const text = await generateText('prompt', 'Balanced', defaultOpts);
    expect(text).toBe('result text');
  });

  it('throws for anthropic provider', async () => {
    await expect(
      generateText('prompt', 'Balanced', { ...defaultOpts, provider: 'anthropic' }),
    ).rejects.toThrow('not available in the browser');
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
});

// ─── streamText (Ollama→Gemini fallback) ─────────────────────────────────────

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
