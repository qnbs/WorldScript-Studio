import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Relative path mock — same resolution trick as aiCoreFallbackPaths.test.ts.
const mockPipelineFn = vi.hoisted(() => vi.fn());

vi.mock(
  '../../packages/ai-core/node_modules/@huggingface/transformers/dist/transformers.web.js',
  () => ({
    pipeline: mockPipelineFn,
  }),
);

// Simulate worker globals. postMessages are pushed to `posted` for assertion.
const posted: unknown[] = [];
const messageListeners: Array<(e: MessageEvent) => void> = [];

vi.stubGlobal('self', {
  addEventListener: (_type: string, handler: (e: MessageEvent) => void) => {
    messageListeners.push(handler);
  },
  postMessage: (msg: unknown) => {
    posted.push(msg);
  },
  location: { origin: '' },
});
vi.stubGlobal('navigator', { hardwareConcurrency: 4 });

function sendMessage(data: unknown) {
  const event = { data, origin: '' } as MessageEvent;
  for (const listener of messageListeners) listener(event);
}

// Wait for a message to appear in `posted`
function waitForResponse(timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (posted.length > 0) {
        resolve(posted.shift());
      } else if (Date.now() > deadline) {
        reject(new Error('waitForResponse timeout'));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
}

beforeAll(async () => {
  await import('../../workers/inference.worker');
  await vi.waitFor(() => messageListeners.length > 0, { timeout: 2000 });
});

describe('inference.worker', () => {
  beforeEach(() => {
    posted.length = 0;
    mockPipelineFn.mockReset();
  });

  afterEach(() => {
    posted.length = 0;
  });

  it('registers a message listener on import', () => {
    expect(messageListeners.length).toBeGreaterThan(0);
  });

  it('returns inference result for text-generation', async () => {
    const mockPipe = vi.fn().mockResolvedValue([{ generated_text: 'Once upon a time' }]);
    mockPipelineFn.mockResolvedValue(mockPipe);

    sendMessage({
      messageId: 'msg-1',
      task: 'text-generation',
      modelId: 'test-model-textgen-001',
      input: 'Once',
    });

    const response = (await waitForResponse()) as {
      messageId: string;
      ok: boolean;
      result: string;
    };
    expect(response.messageId).toBe('msg-1');
    expect(response.ok).toBe(true);
    expect(response.result).toBe('Once upon a time');
  });

  it('returns feature-extraction result as number[]', async () => {
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    const mockPipe = vi.fn().mockResolvedValue(vec);
    mockPipelineFn.mockResolvedValue(mockPipe);

    sendMessage({
      messageId: 'emb-1',
      task: 'feature-extraction',
      modelId: 'test-model-embedding-001',
      input: 'Hello world',
    });

    const response = (await waitForResponse()) as { ok: boolean; result: number[] };
    expect(response.ok).toBe(true);
    expect(Array.isArray(response.result)).toBe(true);
    expect((response.result as number[]).length).toBe(3);
  });

  it('returns error response when pipeline throws', async () => {
    mockPipelineFn.mockRejectedValue(new Error('OOM error'));

    sendMessage({
      messageId: 'err-1',
      task: 'text-generation',
      modelId: 'test-model-error-001',
      input: 'test',
    });

    const response = (await waitForResponse()) as { ok: boolean; error: string };
    expect(response.ok).toBe(false);
    expect(response.error).toContain('OOM');
  });

  it('returns sentiment label for sentiment-analysis task', async () => {
    const mockPipe = vi.fn().mockResolvedValue([{ label: 'POSITIVE', score: 0.9932 }]);
    mockPipelineFn.mockResolvedValue(mockPipe);

    sendMessage({
      messageId: 'sent-1',
      task: 'sentiment-analysis',
      modelId: 'test-model-sentiment-001',
      input: 'I love writing!',
    });

    const response = (await waitForResponse()) as { ok: boolean; result: string };
    expect(response.ok).toBe(true);
    expect(response.result).toMatch(/POSITIVE/);
  });

  it('ignores WORKER_CANCEL messages without posting a response', async () => {
    sendMessage({ type: 'WORKER_CANCEL', messageId: 'nonexistent-cancel-test' });
    await new Promise((r) => setTimeout(r, 100));
    expect(posted).toHaveLength(0);
  });

  it('responds with WORKER_PONG when receiving WORKER_PING', async () => {
    sendMessage({ type: 'WORKER_PING' });
    const response = (await waitForResponse()) as { type: string; ts: number };
    expect(response.type).toBe('WORKER_PONG');
    expect(typeof response.ts).toBe('number');
  });
});
