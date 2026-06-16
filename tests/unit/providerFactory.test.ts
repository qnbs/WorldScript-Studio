import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLanguageModelForWorldScript,
  providerToKind,
} from '../../services/ai/providerFactory';

// ---------------------------------------------------------------------------
// Mocks — SDK provider factories
// ---------------------------------------------------------------------------

const mockGoogleLanguageModel = vi.fn().mockReturnValue({ type: 'gemini-model' });
const mockOpenaiChat = vi.fn().mockReturnValue({ type: 'openai-model' });
// QNBS-v3: accept arg so mock.calls[0][0] is accessible in spread-to-single-arg tests
const mockCreateGoogleGenerativeAI = vi.fn((_arg?: unknown) => ({
  languageModel: mockGoogleLanguageModel,
}));
const mockCreateOpenAI = vi.fn((_arg?: unknown) => ({ chat: mockOpenaiChat }));
// QNBS-v3: deterministic fake fetch — the suite must never depend on real network behaviour
// (test-determinism rule). The factory only passes this through to the SDK; it is never invoked here.
const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
const mockCreateWorldScriptFetch = vi.fn().mockReturnValue(mockFetch);

vi.mock('@ai-sdk/google', () => ({
  // QNBS-v3: cast needed — TS2556 requires tuple or rest for unknown[] spread
  createGoogleGenerativeAI: (arg: unknown) => mockCreateGoogleGenerativeAI(arg),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (arg: unknown) => mockCreateOpenAI(arg),
}));

vi.mock('../../services/ai/fetchAdapter', () => ({
  createWorldScriptFetch: () => mockCreateWorldScriptFetch(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateGoogleGenerativeAI.mockReturnValue({ languageModel: mockGoogleLanguageModel });
  mockCreateOpenAI.mockReturnValue({ chat: mockOpenaiChat });
});

// ---------------------------------------------------------------------------
// providerToKind
// ---------------------------------------------------------------------------
describe('providerToKind', () => {
  it('maps gemini to gemini', () => {
    expect(providerToKind('gemini')).toBe('gemini');
  });

  it('maps openai to openai', () => {
    expect(providerToKind('openai')).toBe('openai');
  });

  it('maps ollama to openaiCompatible', () => {
    expect(providerToKind('ollama')).toBe('openaiCompatible');
  });

  it('maps webllm to unsupported', () => {
    expect(providerToKind('webllm')).toBe('unsupported');
  });

  it('maps anthropic to unsupported', () => {
    expect(providerToKind('anthropic')).toBe('unsupported');
  });

  it('maps grok to unsupported', () => {
    expect(providerToKind('grok')).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// createLanguageModelForWorldScript
// ---------------------------------------------------------------------------
describe('createLanguageModelForWorldScript', () => {
  describe('gemini provider', () => {
    it('creates a Gemini language model with the given apiKey and modelId', () => {
      const model = createLanguageModelForWorldScript({
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        apiKey: 'test-gemini-key',
      });

      expect(mockCreateGoogleGenerativeAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-gemini-key' }),
      );
      expect(mockGoogleLanguageModel).toHaveBeenCalledWith('gemini-2.5-flash');
      expect(model).toEqual({ type: 'gemini-model' });
    });

    it('passes the custom fetch implementation', () => {
      createLanguageModelForWorldScript({
        provider: 'gemini',
        modelId: 'gemini-2.0-flash',
        apiKey: 'key',
      });
      const callArg = (
        mockCreateGoogleGenerativeAI.mock.calls[0] as unknown as [Record<string, unknown>]
      )?.[0];
      expect(callArg?.['fetch']).toBeDefined();
    });
  });

  describe('openai provider', () => {
    it('creates an OpenAI chat model', () => {
      const model = createLanguageModelForWorldScript({
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-test' }));
      expect(mockOpenaiChat).toHaveBeenCalledWith('gpt-4o');
      expect(model).toEqual({ type: 'openai-model' });
    });

    it('passes optional headers when provided', () => {
      createLanguageModelForWorldScript({
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        headers: { 'X-Custom': 'value' },
      });
      const callArg = (mockCreateOpenAI.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
      expect(callArg?.['headers']).toEqual({ 'X-Custom': 'value' });
    });

    it('omits headers property when not provided', () => {
      createLanguageModelForWorldScript({
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
      });
      const callArg = (mockCreateOpenAI.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
      expect(callArg?.['headers']).toBeUndefined();
    });
  });

  describe('openaiCompatible provider (Ollama / LM Studio)', () => {
    it('creates an OpenAI-compatible model with baseURL', () => {
      const model = createLanguageModelForWorldScript({
        provider: 'openaiCompatible',
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
        modelId: 'llama3',
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://localhost:11434/v1',
          apiKey: 'ollama',
        }),
      );
      expect(mockOpenaiChat).toHaveBeenCalledWith('llama3');
      expect(model).toEqual({ type: 'openai-model' });
    });

    it('passes optional headers for openaiCompatible', () => {
      createLanguageModelForWorldScript({
        provider: 'openaiCompatible',
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
        modelId: 'llama3',
        headers: { 'HTTP-Referer': 'https://myapp.com' },
      });
      // QNBS-v3: vi.fn mock.calls is typed as unknown[][], cast through unknown to avoid TS2352
      const callArg = (mockCreateOpenAI.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
      expect(callArg?.['headers']).toEqual({ 'HTTP-Referer': 'https://myapp.com' });
    });
  });
});
