import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORLDSCRIPT_COMPLETION_URL,
  worldScriptCompletionFetch,
} from '../../../services/ai/worldScriptCompletionFetch';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStreamTextResult = {
  toTextStreamResponse: vi.fn().mockReturnValue(new Response('streamed text', { status: 200 })),
};
const mockStreamText = vi.fn().mockReturnValue(mockStreamTextResult);
const mockAssertCloudAiAllowed = vi.fn().mockResolvedValue(undefined);
const mockGetGeminiApiKey = vi.fn().mockResolvedValue('gemini-key');
const mockGetApiKey = vi.fn().mockResolvedValue('openai-key');
const mockCreateLanguageModelForWorldScript = vi.fn().mockReturnValue({ type: 'mock-model' });
const mockProviderToKind = vi.fn().mockReturnValue('gemini');

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowed: (...args: unknown[]) => mockAssertCloudAiAllowed(...args),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getGeminiApiKey: () => mockGetGeminiApiKey(),
    getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
  },
}));

vi.mock('../../../services/ai/providerFactory', () => ({
  createLanguageModelForWorldScript: (...args: unknown[]) =>
    mockCreateLanguageModelForWorldScript(...args),
  providerToKind: (...args: unknown[]) => mockProviderToKind(...args),
}));

const { logWithContextSpy } = vi.hoisted(() => ({ logWithContextSpy: vi.fn() }));
vi.mock('../../../services/logger', () => {
  const stub = (): Record<string, unknown> => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withContext: (ctx: unknown) => {
      logWithContextSpy(ctx);
      return stub();
    },
  });
  return {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    createLogger: () => stub(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    prompt: 'Write a story.',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    creativity: 'Balanced',
    ...overrides,
  });
}

function makeInit(body: string, signal?: AbortSignal): RequestInit {
  // QNBS-v3: exactOptionalPropertyTypes forbids explicit undefined for optional signal
  return signal !== undefined ? { body, signal } : { body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProviderToKind.mockReturnValue('gemini');
  mockGetGeminiApiKey.mockResolvedValue('gemini-key');
  mockGetApiKey.mockResolvedValue('openai-key');
  mockAssertCloudAiAllowed.mockResolvedValue(undefined);
  mockStreamText.mockReturnValue(mockStreamTextResult);
  mockStreamTextResult.toTextStreamResponse.mockReturnValue(new Response('ok', { status: 200 }));
  mockCreateLanguageModelForWorldScript.mockReturnValue({ type: 'mock-model' });
});

// ---------------------------------------------------------------------------
// WORLDSCRIPT_COMPLETION_URL
// ---------------------------------------------------------------------------
describe('WORLDSCRIPT_COMPLETION_URL', () => {
  it('is the worldscript internal protocol URL', () => {
    expect(WORLDSCRIPT_COMPLETION_URL).toBe('worldscript-internal://completion');
  });
});

// ---------------------------------------------------------------------------
// worldScriptCompletionFetch — error paths
// ---------------------------------------------------------------------------
describe('worldScriptCompletionFetch — invalid body', () => {
  it('returns 500 when body is missing (generic error path)', async () => {
    // QNBS-v3: missing body throws generic Error (not ZodError) → caught as 500
    const res = await worldScriptCompletionFetch('worldscript-internal://completion', {});
    expect(res.status).toBe(500);
  });

  it('returns 500 when body is not a string', async () => {
    const res = await worldScriptCompletionFetch('worldscript-internal://completion', {
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(500);
  });

  it('returns 500 for invalid JSON body (SyntaxError caught as generic)', async () => {
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit('not-json'),
    );
    expect(res.status).toBe(500);
  });

  it('returns 400 for schema validation failure (missing prompt)', async () => {
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(
        JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-flash', creativity: 'Balanced' }),
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe('worldScriptCompletionFetch — unsupported provider', () => {
  it('returns 422 for unsupported provider', async () => {
    mockProviderToKind.mockReturnValue('unsupported');
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody({ provider: 'anthropic' })),
    );
    expect(res.status).toBe(422);
  });
});

describe('worldScriptCompletionFetch — missing API key', () => {
  it('returns 401 when Gemini API key is missing', async () => {
    mockGetGeminiApiKey.mockResolvedValue(null);
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody()),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when OpenAI API key is missing', async () => {
    mockProviderToKind.mockReturnValue('openai');
    mockGetApiKey.mockResolvedValue(null);
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody({ provider: 'openai', model: 'gpt-4o' })),
    );
    expect(res.status).toBe(401);
  });
});

describe('worldScriptCompletionFetch — abort handling', () => {
  it('throws DOMException AbortError when signal is already aborted', async () => {
    // QNBS-v3: code throws DOMException('Aborted', 'AbortError') — message is 'Aborted', name is 'AbortError'
    const controller = new AbortController();
    controller.abort();
    await expect(
      worldScriptCompletionFetch(
        'worldscript-internal://completion',
        makeInit(makeBody(), controller.signal),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && (e as DOMException).name === 'AbortError',
    );
  });
});

describe('worldScriptCompletionFetch — success (gemini)', () => {
  it('calls streamText and returns stream response', async () => {
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody()),
    );
    expect(mockStreamText).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('passes temperature from creativity setting', async () => {
    await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody({ creativity: 'Focused' })),
    );
    const callArgs = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['temperature']).toBe(0.2);
  });

  it('defaults maxOutputTokens to 2048 when not provided', async () => {
    await worldScriptCompletionFetch('worldscript-internal://completion', makeInit(makeBody()));
    const callArgs = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['maxOutputTokens']).toBe(2048);
  });

  it('uses provided maxOutputTokens when specified', async () => {
    await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody({ maxOutputTokens: 4096 })),
    );
    const callArgs = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['maxOutputTokens']).toBe(4096);
  });
});

describe('worldScriptCompletionFetch — success (ollama)', () => {
  it('resolves ollama provider to openaiCompatible', async () => {
    mockProviderToKind.mockReturnValue('openaiCompatible');
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(
        makeBody({
          provider: 'ollama',
          model: 'ollama/llama3',
          ollamaBaseUrl: 'http://localhost:11434',
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockCreateLanguageModelForWorldScript).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openaiCompatible', apiKey: 'ollama' }),
    );
  });
});

describe('worldScriptCompletionFetch — unexpected error', () => {
  it('returns 500 for unexpected errors', async () => {
    mockAssertCloudAiAllowed.mockRejectedValue(new Error('Network error'));
    const res = await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody()),
    );
    expect(res.status).toBe(500);
  });

  it('logs the failure with the propagated correlationId (Phase 1)', async () => {
    logWithContextSpy.mockClear();
    mockAssertCloudAiAllowed.mockRejectedValue(new Error('Network error'));
    await worldScriptCompletionFetch(
      'worldscript-internal://completion',
      makeInit(makeBody({ correlationId: 'ai-zzz999' })),
    );
    expect(logWithContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'ai-zzz999' }),
    );
  });
});
