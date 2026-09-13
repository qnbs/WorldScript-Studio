import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORLDSCRIPT_COMPLETION_URL,
  worldScriptCompletionFetch,
} from '../../../services/ai/worldScriptCompletionFetch';

const outboundFetch = vi.fn();
const mockGetApiKey = vi.fn().mockResolvedValue('openai-key');
const mockAssertCloudAiAllowed = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
    getGeminiApiKey: vi.fn(),
  },
}));

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowed: (...args: unknown[]) => mockAssertCloudAiAllowed(...args),
}));

function makeInit(body: Record<string, unknown>): RequestInit {
  return { body: JSON.stringify(body) };
}

describe('worldScriptCompletionFetch — OpenAI outbound body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as Record<string, unknown>)['__TAURI__'];
    outboundFetch.mockResolvedValue(
      new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', outboundFetch);
  });

  it('keeps reasoning parameters on the WorldScript route for an explicit official root', async () => {
    const response = await worldScriptCompletionFetch(
      WORLDSCRIPT_COMPLETION_URL,
      makeInit({
        prompt: 'Write a story.',
        provider: 'openai',
        model: 'o3',
        creativity: 'Balanced',
        maxOutputTokens: 123,
        openAiCompatibleBaseUrl: 'https://api.openai.com/v1',
      }),
    );

    expect(response.status).toBe(200);
    await response.text();

    expect(outboundFetch).toHaveBeenCalledTimes(1);
    const [input, init] = outboundFetch.mock.calls[0] as [string, RequestInit];
    expect(input).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'o3',
      max_completion_tokens: 123,
      stream: true,
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
  });
});
