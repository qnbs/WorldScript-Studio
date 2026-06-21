import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listOllamaModels,
  type OllamaPullProgress,
  pullOllamaModel,
  streamOllama,
  testOllamaConnection,
} from '../../services/ollamaService';

/** Build a streaming NDJSON Response (one JSON object per line) for /api/pull mocks. */
function ndjsonResponse(objects: object[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const o of objects) controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

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

  it('throws on fetch failure without firing onError (orchestrator owns onError)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('ECONNREFUSED'));

    // QNBS-v3: the provider only throws; aiProviderService.streamText fires onError once after the
    // fallback chain is exhausted, so the provider must NOT call onError (avoids double-firing).
    const onError = vi.fn();
    await expect(
      streamOllama('prompt', { model: 'llama3' }, { onChunk: vi.fn(), onError }),
    ).rejects.toThrow('Ollama not reachable');
    expect(onError).not.toHaveBeenCalled();
  });

  it('throws on non-200 response without firing onError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('', { status: 404, statusText: 'Not Found' }),
    );

    const onError = vi.fn();
    await expect(
      streamOllama('prompt', { model: 'llama3' }, { onChunk: vi.fn(), onError }),
    ).rejects.toThrow('404');
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores malformed JSON lines without crashing', async () => {
    const lines = ['not-json', JSON.stringify({ response: 'ok' }), JSON.stringify({ done: true })];
    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(lines));

    const chunks: string[] = [];
    await streamOllama('prompt', { model: 'llama3' }, { onChunk: (c) => chunks.push(c) });

    expect(chunks).toEqual(['ok']);
  });
});

// ─── pullOllamaModel ──────────────────────────────────────────────────────────

describe('pullOllamaModel', () => {
  it('streams progress and resolves on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      ndjsonResponse([
        { status: 'pulling manifest' },
        { status: 'downloading', total: 1000, completed: 250 },
        { status: 'downloading', total: 1000, completed: 1000 },
        { status: 'success' },
      ]),
    );
    const progress: OllamaPullProgress[] = [];
    await pullOllamaModel('llama3.2:1b', { onProgress: (p) => progress.push(p) });

    expect(progress.map((p) => p.status)).toEqual([
      'pulling manifest',
      'downloading',
      'downloading',
      'success',
    ]);
    // mid-download fraction surfaced
    expect(progress[1]).toMatchObject({ progress: 0.25, completedBytes: 250, totalBytes: 1000 });
    expect(progress[2]?.progress).toBe(1);
    // manifest/success lines (no byte counts) omit the progress fraction
    expect(progress[0]?.progress).toBeUndefined();
  });

  it('POSTs to /api/pull with the stripped model name and stream:true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse([{ status: 'success' }]));
    await pullOllamaModel('ollama/llama3.2:3b', { baseUrl: 'http://host:11434/' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://host:11434/api/pull');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'llama3.2:3b', stream: true });
  });

  it('throws on an inline {error} line (Ollama reports failures in-band)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      ndjsonResponse([{ status: 'pulling manifest' }, { error: 'manifest unknown' }]),
    );
    await expect(pullOllamaModel('bogus:latest')).rejects.toThrow(/manifest unknown/);
  });

  it('throws a reachability error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network error'));
    await expect(pullOllamaModel('llama3.2:1b')).rejects.toThrow(/not reachable/);
  });

  it('throws on a non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('', { status: 500, statusText: 'Server Error' }),
    );
    await expect(pullOllamaModel('llama3.2:1b')).rejects.toThrow(/pull failed 500/);
  });

  it('propagates an AbortError unchanged (cancel, not failure)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.mocked(fetch).mockRejectedValueOnce(abortErr);
    await expect(pullOllamaModel('llama3.2:1b')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an empty model name', async () => {
    await expect(pullOllamaModel('   ')).rejects.toThrow(/model name is required/);
  });
});
