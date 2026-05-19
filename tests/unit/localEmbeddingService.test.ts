import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Self-resolving MockWorker — when postMessage is called it immediately fires
//          all registered 'message' handlers with a configurable response. This avoids
//          async timing issues with concurrent Promise.all batches in embedBatch.
let mockResponse: { ok: boolean; result?: number[]; error?: string } = {
  ok: true,
  result: [0.5, 0.5],
};

let postMessageCalls: Array<{ messageId: string; input: string; task: string }> = [];

class MockWorker {
  private handlers: Array<(e: MessageEvent) => void> = [];

  addEventListener(_type: string, handler: (e: MessageEvent) => void) {
    this.handlers.push(handler);
  }

  removeEventListener(_type: string, handler: (e: MessageEvent) => void) {
    const idx = this.handlers.indexOf(handler);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }

  postMessage(msg: { messageId: string; input: string; task: string }) {
    postMessageCalls.push(msg);
    // QNBS-v3: Respond synchronously so Promise.all batches resolve without microtask tricks.
    const response = { ...mockResponse, messageId: msg.messageId };
    const event = { data: response } as MessageEvent;
    for (const handler of [...this.handlers]) {
      handler(event);
    }
  }

  terminate() {}
}

vi.stubGlobal('Worker', MockWorker);

import {
  _resetWorkerForTest,
  cosineSimilarity,
  embedBatch,
  embedText,
} from '../../services/ai/localEmbeddingService';

beforeEach(() => {
  _resetWorkerForTest();
  mockResponse = { ok: true, result: [0.5, 0.5] };
  postMessageCalls = [];
});

afterEach(() => {
  _resetWorkerForTest();
});

// ─── embedText ──────────────────────────────────────────────────────────────

describe('embedText', () => {
  it('returns a Float32Array for a successful worker response', async () => {
    mockResponse = { ok: true, result: [0.5, 0.5] };
    const vec = await embedText('Hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(2);
  });

  it('L2-normalises the returned vector (magnitude ≈ 1)', async () => {
    mockResponse = { ok: true, result: [3, 4] }; // magnitude = 5 → normalised to [0.6, 0.8]
    const vec = await embedText('Normalise me');
    const magnitude = Math.sqrt(vec[0]! ** 2 + vec[1]! ** 2);
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('throws when worker returns ok:false with error message', async () => {
    mockResponse = { ok: false, error: 'OOM' };
    await expect(embedText('fail case')).rejects.toThrow('OOM');
  });

  it('throws with generic message when error field is absent', async () => {
    mockResponse = { ok: false };
    await expect(embedText('fail case 2')).rejects.toThrow('embedding failed');
  });

  it('truncates input silently when text exceeds 512 chars', async () => {
    await embedText('a'.repeat(600));
    expect(postMessageCalls[0]?.input.length).toBe(512);
  });

  it('does not truncate input at exactly 512 chars', async () => {
    await embedText('b'.repeat(512));
    expect(postMessageCalls[0]?.input.length).toBe(512);
  });

  it('sends feature-extraction task to worker', async () => {
    await embedText('test');
    expect(postMessageCalls[0]?.task).toBe('feature-extraction');
  });
});

// ─── embedBatch ─────────────────────────────────────────────────────────────

describe('embedBatch', () => {
  it('returns an array of Float32Arrays, one per input', async () => {
    mockResponse = { ok: true, result: [0.5, 0.5] };
    const results = await embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toBeInstanceOf(Float32Array);
    }
  });

  it('returns correct count for 9 texts (spans two micro-batches of 8+1)', async () => {
    mockResponse = { ok: true, result: [0.1, 0.2] };
    const texts = Array.from({ length: 9 }, (_, i) => `text-${i}`);
    const results = await embedBatch(texts);
    expect(results).toHaveLength(9);
  });

  it('sends exactly N worker messages for N input texts', async () => {
    mockResponse = { ok: true, result: [0.1, 0.2] };
    await embedBatch(['x', 'y', 'z']);
    expect(postMessageCalls).toHaveLength(3);
  });

  it('returns empty array for empty input', async () => {
    const results = await embedBatch([]);
    expect(results).toHaveLength(0);
  });
});

// ─── cosineSimilarity ───────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposing unit vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('returns 0 for vectors of mismatched length', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity(new Float32Array([]), new Float32Array([]))).toBe(0);
  });

  it('clamps result to [-1, 1] for floating point drift', () => {
    const a = new Float32Array([0.5773502691896258, 0.5773502691896258, 0.5773502691896258]);
    const result = cosineSimilarity(a, a);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(-1);
  });
});
