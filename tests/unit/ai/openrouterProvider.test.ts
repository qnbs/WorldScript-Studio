/**
 * Tests for services/ai/providers/openrouterProvider.ts
 * QNBS-v3: Utility functions, streaming/non-streaming completion, retry/backoff,
 *          circuit breaker, AbortSignal, and RPM tracking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTestDelayProvider,
  __setTestDelayProvider,
  generateOpenRouterText,
  getApproxRpm,
  isCircuitOpen,
  isOpenRouterFreeModel,
  OPENROUTER_FREE_MODELS,
  resetOpenRouterCircuit,
  streamOpenRouter,
} from '../../../services/ai/providers/openrouterProvider';
import type { AIRequestOptions, AIStreamCallbacks } from '../../../services/aiProviderService';

const baseOpts: AIRequestOptions = {
  model: 'deepseek/deepseek-r1:free' as AIRequestOptions['model'],
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 128,
};

function makeStreamResponse(
  lines: string[],
  opts: { status?: number; retryAfter?: string } = {},
): Response {
  const encoder = new TextEncoder();
  const chunks = lines.map((line) => encoder.encode(`${line}\n`));
  let index = 0;
  return {
    ok: opts.status === undefined ? true : opts.status >= 200 && opts.status < 300,
    status: opts.status ?? 200,
    statusText: opts.status === 429 ? 'Too Many Requests' : 'OK',
    headers: new Headers(opts.retryAfter ? { 'retry-after': opts.retryAfter } : {}),
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = chunks[index];
          index++;
          return { done: false, value };
        },
      }),
    },
  } as unknown as Response;
}

function sseLine(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}`;
}

function makeJsonResponse(
  body: unknown,
  opts: { status?: number; retryAfter?: string } = {},
): Response {
  return {
    ok: opts.status === undefined ? true : opts.status >= 200 && opts.status < 300,
    status: opts.status ?? 200,
    statusText: opts.status === 429 ? 'Too Many Requests' : 'OK',
    headers: new Headers(opts.retryAfter ? { 'retry-after': opts.retryAfter } : {}),
    json: async () => body,
  } as unknown as Response;
}

describe('isOpenRouterFreeModel()', () => {
  it('returns true for :free suffix models', () => {
    expect(isOpenRouterFreeModel('deepseek/deepseek-r1:free')).toBe(true);
    expect(isOpenRouterFreeModel('meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
  });

  it('returns false for paid models', () => {
    expect(isOpenRouterFreeModel('deepseek/deepseek-r1')).toBe(false);
    expect(isOpenRouterFreeModel('openai/gpt-4o')).toBe(false);
  });

  it('all OPENROUTER_FREE_MODELS entries are free models', () => {
    for (const model of OPENROUTER_FREE_MODELS) {
      expect(isOpenRouterFreeModel(model)).toBe(true);
    }
  });
});

describe('isCircuitOpen()', () => {
  it('starts closed', () => {
    expect(isCircuitOpen()).toBe(false);
  });

  it('resets to closed after resetOpenRouterCircuit()', () => {
    resetOpenRouterCircuit();
    expect(isCircuitOpen()).toBe(false);
  });
});

describe('getApproxRpm()', () => {
  it('returns a number ≥ 0', () => {
    expect(getApproxRpm()).toBeGreaterThanOrEqual(0);
  });
});

describe('streamOpenRouter()', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    resetOpenRouterCircuit();
    __setTestDelayProvider(() => Promise.resolve());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    __resetTestDelayProvider();
  });

  it('streams chunks through callbacks', async () => {
    const chunks: string[] = [];
    const callbacks: AIStreamCallbacks = {
      onChunk: (text) => chunks.push(text),
      onDone: vi.fn(),
    };

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([sseLine('Hello'), sseLine(' world'), 'data: [DONE]']),
      ) as unknown as typeof fetch;

    await streamOpenRouter('Say hi', baseOpts, callbacks, 'key');
    expect(chunks).toEqual(['Hello', ' world']);
    expect(callbacks.onDone).toHaveBeenCalled();
  });

  it('throws circuit-open error without calling fetch', async () => {
    // Force circuit open by simulating 4 consecutive 429s first
    global.fetch = vi.fn().mockResolvedValue(makeStreamResponse([], { status: 429 }));
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn() };

    for (let i = 0; i < 4; i++) {
      await expect(streamOpenRouter('x', baseOpts, callbacks, 'key')).rejects.toThrow(/OPENROUTER/);
    }

    expect(isCircuitOpen()).toBe(true);

    global.fetch = vi.fn().mockResolvedValue(makeStreamResponse([sseLine('no')])); // should not be called
    await expect(streamOpenRouter('x', baseOpts, callbacks, 'key')).rejects.toThrow(
      /OPENROUTER_CIRCUIT_OPEN/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries on 429 and eventually succeeds', async () => {
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn(), onDone: vi.fn() };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStreamResponse([], { status: 429 }))
      .mockResolvedValueOnce(makeStreamResponse([sseLine('ok')]));

    await streamOpenRouter('x', baseOpts, callbacks, 'key');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(callbacks.onChunk).toHaveBeenCalledWith('ok');
  });

  it('throws rate-limited after max retries', async () => {
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn() };
    global.fetch = vi.fn().mockResolvedValue(makeStreamResponse([], { status: 429 }));

    await expect(streamOpenRouter('x', baseOpts, callbacks, 'key')).rejects.toThrow(
      /OPENROUTER_RATE_LIMITED/,
    );
    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('respects Retry-After header', async () => {
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn() };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStreamResponse([], { status: 429, retryAfter: '2' }))
      .mockResolvedValueOnce(makeStreamResponse([sseLine('delayed')]));

    await streamOpenRouter('x', baseOpts, callbacks, 'key');
    expect(callbacks.onChunk).toHaveBeenCalledWith('delayed');
  });

  it('throws on non-OK status', async () => {
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn() };
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ error: { message: 'Bad key' } }, { status: 401 }));

    await expect(streamOpenRouter('x', baseOpts, callbacks, 'key')).rejects.toThrow(
      /OpenRouter API Error 401/,
    );
  });

  it('stops reading when signal is aborted', async () => {
    const callbacks: AIStreamCallbacks = { onChunk: vi.fn() };
    global.fetch = vi.fn().mockResolvedValue(makeStreamResponse([sseLine('a'), sseLine('b')]));

    const controller = new AbortController();
    const opts: AIRequestOptions = { ...baseOpts, signal: controller.signal };

    // Abort before reading starts
    controller.abort();
    await streamOpenRouter('x', opts, callbacks, 'key');
    expect(callbacks.onChunk).not.toHaveBeenCalled();
  });

  it('skips malformed SSE chunks', async () => {
    const chunks: string[] = [];
    const callbacks: AIStreamCallbacks = { onChunk: (text) => chunks.push(text) };
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeStreamResponse([sseLine('good'), 'data: not-json', sseLine('end')]));

    await streamOpenRouter('x', baseOpts, callbacks, 'key');
    expect(chunks).toEqual(['good', 'end']);
  });
});

describe('generateOpenRouterText()', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    resetOpenRouterCircuit();
    __setTestDelayProvider(() => Promise.resolve());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    __resetTestDelayProvider();
  });

  it('returns generated text', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ choices: [{ message: { content: 'Generated text' } }] }),
      );

    const text = await generateOpenRouterText('prompt', baseOpts, 'key');
    expect(text).toBe('Generated text');
  });

  it('throws on empty response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));

    await expect(generateOpenRouterText('prompt', baseOpts, 'key')).rejects.toThrow(
      /Empty response/,
    );
  });

  it('retries on 429 and uses fallback after persistent rate limits', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse({}, { status: 429 }));

    await expect(generateOpenRouterText('prompt', baseOpts, 'key')).rejects.toThrow(
      /OPENROUTER_RATE_LIMITED/,
    );
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('throws circuit-open error when circuit is open', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse({}, { status: 429 }));
    for (let i = 0; i < 4; i++) {
      await expect(generateOpenRouterText('x', baseOpts, 'key')).rejects.toThrow(/OPENROUTER/);
    }

    global.fetch = vi.fn();
    await expect(generateOpenRouterText('x', baseOpts, 'key')).rejects.toThrow(
      /OPENROUTER_CIRCUIT_OPEN/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('tracks approximate RPM', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    const before = getApproxRpm();
    await generateOpenRouterText('x', baseOpts, 'key');
    expect(getApproxRpm()).toBe(before + 1);
  });
});
