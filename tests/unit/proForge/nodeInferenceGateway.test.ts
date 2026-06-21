/**
 * Tests for services/proForge/adapters/nodeInferenceGateway.ts — the Node/MCP InferenceGateway
 * adapter over @google/genai. Mocks the SDK; no network, no real API key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerate, mockEmbed } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockEmbed: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  // QNBS-v3: a real class — vi.fn() instances aren't reliably `new`-able across module boundaries.
  GoogleGenAI: class {
    models = { generateContent: mockGenerate, embedContent: mockEmbed };
  },
}));

import {
  NodeInferenceGateway,
  resolveNodeApiKey,
} from '../../../services/proForge/adapters/nodeInferenceGateway';

const gw = () => new NodeInferenceGateway({ apiKey: 'test-key' });
const genReq = (over: Record<string, unknown> = {}) =>
  ({
    prompt: 'hello',
    creativity: 'Balanced',
    options: { model: '', maxTokens: undefined },
    ...over,
  }) as unknown as Parameters<NodeInferenceGateway['generate']>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({ text: 'response' });
  mockEmbed.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });
});

// ---------------------------------------------------------------------------
// resolveNodeApiKey
// ---------------------------------------------------------------------------
describe('resolveNodeApiKey', () => {
  it('resolves GEMINI_API_KEY first', () => {
    expect(resolveNodeApiKey({ GEMINI_API_KEY: 'g', WORLDSCRIPT_API_KEY: 'w' })).toBe('g');
  });

  it('falls back to WORLDSCRIPT_API_KEY then GOOGLE_GENERATIVE_AI_API_KEY', () => {
    expect(resolveNodeApiKey({ WORLDSCRIPT_API_KEY: 'w' })).toBe('w');
    expect(resolveNodeApiKey({ GOOGLE_GENERATIVE_AI_API_KEY: 'goog' })).toBe('goog');
  });

  it('throws a clear error when no key env var is set', () => {
    expect(() => resolveNodeApiKey({})).toThrow(/Missing API key/);
  });
});

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------
describe('NodeInferenceGateway.generate', () => {
  it('returns the SDK text tagged with model/provider and isFallback:false', async () => {
    const res = await gw().generate(genReq());
    expect(res).toMatchObject({
      text: 'response',
      model: 'gemini-2.0-flash',
      provider: 'gemini',
      isFallback: false,
    });
  });

  it('maps creativity to temperature (Focused → 0.3, Imaginative → 1.0)', async () => {
    await gw().generate(genReq({ creativity: 'Focused' }));
    expect(mockGenerate.mock.calls[0]?.[0].config.temperature).toBe(0.3);
    mockGenerate.mockClear();
    await gw().generate(genReq({ creativity: 'Imaginative' }));
    expect(mockGenerate.mock.calls[0]?.[0].config.temperature).toBe(1.0);
  });

  it('honours a custom model from the request and forwards maxTokens', async () => {
    await gw().generate(genReq({ options: { model: 'gemini-1.5-pro', maxTokens: 512 } }));
    const arg = mockGenerate.mock.calls[0]?.[0];
    expect(arg.model).toBe('gemini-1.5-pro');
    expect(arg.config.maxOutputTokens).toBe(512);
  });

  it('omits maxOutputTokens when maxTokens is undefined', async () => {
    await gw().generate(genReq());
    expect(mockGenerate.mock.calls[0]?.[0].config).not.toHaveProperty('maxOutputTokens');
  });

  it('returns empty text when the SDK omits it', async () => {
    mockGenerate.mockResolvedValueOnce({});
    expect((await gw().generate(genReq())).text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// embed
// ---------------------------------------------------------------------------
describe('NodeInferenceGateway.embed', () => {
  it('returns the embedding vector', async () => {
    expect(await gw().embed({ text: 'x' })).toEqual({ vector: [0.1, 0.2, 0.3] });
  });

  it('returns an empty vector on SDK error (best-effort)', async () => {
    mockEmbed.mockRejectedValueOnce(new Error('quota'));
    expect(await gw().embed({ text: 'x' })).toEqual({ vector: [] });
  });

  it('returns an empty vector when no embeddings are present', async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [] });
    expect(await gw().embed({ text: 'x' })).toEqual({ vector: [] });
  });
});

// ---------------------------------------------------------------------------
// modelList + healthCheck
// ---------------------------------------------------------------------------
describe('NodeInferenceGateway.modelList / healthCheck', () => {
  it('lists the default Gemini model', async () => {
    const list = await gw().modelList();
    expect(list).toEqual([
      {
        id: 'gemini-2.0-flash',
        provider: 'gemini',
        displayName: 'gemini-2.0-flash',
        isLocal: false,
      },
    ]);
  });

  it('reports ok health when a ping generation succeeds', async () => {
    const health = await gw().healthCheck();
    expect(health.status).toBe('ok');
    expect(health.provider).toBe('gemini');
    expect(typeof health.latencyMs).toBe('number');
  });

  it('reports unavailable health when the ping throws', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('down'));
    expect((await gw().healthCheck()).status).toBe('unavailable');
  });
});
