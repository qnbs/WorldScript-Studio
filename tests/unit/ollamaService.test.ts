import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listOllamaModels, streamOllama, testOllamaConnection } from '../../services/ollamaService';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── listOllamaModels ─────────────────────────────────────────────────────────

describe('listOllamaModels', () => {
  it('returns model names on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: 'llama3' }, { name: 'mistral' }] }), {
        status: 200,
      }),
    );

    const models = await listOllamaModels();
    expect(models).toEqual(['llama3', 'mistral']);
  });

  it('returns empty array on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await listOllamaModels()).toEqual([]);
  });

  it('returns empty array on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network error'));
    expect(await listOllamaModels()).toEqual([]);
  });

  it('uses custom baseUrl (trailing slash stripped)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    await listOllamaModels('http://myhost:11434/');
    expect(fetch).toHaveBeenCalledWith('http://myhost:11434/api/tags', expect.any(Object));
  });
});

// ─── testOllamaConnection ─────────────────────────────────────────────────────

describe('testOllamaConnection', () => {
  it('returns ok:true on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    const result = await testOllamaConnection();
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false with error message on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    const result = await testOllamaConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
  });

  it('returns ok:false with error message on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Connection refused'));
    const result = await testOllamaConnection('http://localhost:11434');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('localhost:11434');
    expect(result.error).toContain('Connection refused');
  });
});

// ─── streamOllama ─────────────────────────────────────────────────────────────

function makeStreamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('streamOllama', () => {
  it('calls onChunk for each response token', async () => {
    const lines = [
      JSON.stringify({ response: 'Hello' }),
      JSON.stringify({ response: ' World', done: false }),
      JSON.stringify({ done: true }),
    ];
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(lines));

    const chunks: string[] = [];
    const onDone = vi.fn();

    await streamOllama(
      'test prompt',
      { model: 'llama3' },
      { onChunk: (c) => chunks.push(c), onDone },
    );

    expect(chunks).toEqual(['Hello', ' World']);
    expect(onDone).toHaveBeenCalled();
  });

  it('strips ollama/ prefix from model name', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse([JSON.stringify({ done: true })]));

    await streamOllama('prompt', { model: 'ollama/mistral' }, { onChunk: vi.fn() });

    const bodyStr = vi.mocked(fetch).mock.calls[0]![1]!.body as string;
    expect(JSON.parse(bodyStr).model).toBe('mistral');
  });

  it('calls onError and throws on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('ECONNREFUSED'));

    const onError = vi.fn();
    await expect(
      streamOllama('prompt', { model: 'llama3' }, { onChunk: vi.fn(), onError }),
    ).rejects.toThrow('Ollama not reachable');
    expect(onError).toHaveBeenCalled();
  });

  it('calls onError and throws on non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('', { status: 404, statusText: 'Not Found' }),
    );

    const onError = vi.fn();
    await expect(
      streamOllama('prompt', { model: 'llama3' }, { onChunk: vi.fn(), onError }),
    ).rejects.toThrow('404');
    expect(onError).toHaveBeenCalled();
  });

  it('ignores malformed JSON lines without crashing', async () => {
    const lines = ['not-json', JSON.stringify({ response: 'ok' }), JSON.stringify({ done: true })];
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(lines));

    const chunks: string[] = [];
    await streamOllama('prompt', { model: 'llama3' }, { onChunk: (c) => chunks.push(c) });

    expect(chunks).toEqual(['ok']);
  });
});
