import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: [localEmbeddingService now routes through WorkerBus v2 — mock ensureInferencePool() instead of the global Worker constructor.]

const { mockEnqueue, mockEnsureInferencePool } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnsureInferencePool: vi.fn(),
}));

vi.mock('../../services/workerBusManager', () => ({
  ensureInferencePool: mockEnsureInferencePool,
}));

const { clearEmbeddingCache, cosineSimilarity, embedBatch, embedText } = await import(
  '../../services/ai/localEmbeddingService'
);

function makeHandle(result: Promise<unknown>) {
  return { taskId: 't1', result, progress: (async function* () {})(), cancel: vi.fn() };
}

function makeBus() {
  return { enqueue: mockEnqueue };
}

let requestCalls: Array<{ task: string; modelId: string; input: string }> = [];
let nextResult: number[] = [0.5, 0.5];

beforeEach(() => {
  vi.clearAllMocks();
  clearEmbeddingCache();
  requestCalls = [];
  nextResult = [0.5, 0.5];
  mockEnsureInferencePool.mockResolvedValue(makeBus());
  mockEnqueue.mockImplementation((_taskType: string, payload: unknown) => {
    requestCalls.push(payload as { task: string; modelId: string; input: string });
    return makeHandle(Promise.resolve(nextResult));
  });
});

// ─── embedText ──────────────────────────────────────────────────────────────

describe('embedText', () => {
  it('returns a Float32Array for a successful task result', async () => {
    nextResult = [0.5, 0.5];
    const vec = await embedText('Hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(2);
  });

  it('L2-normalises the returned vector (magnitude ≈ 1)', async () => {
    nextResult = [3, 4]; // magnitude = 5 → normalised to [0.6, 0.8]
    const vec = await embedText('Normalise me');
    const magnitude = Math.sqrt(vec[0]! ** 2 + vec[1]! ** 2);
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('propagates the error message when the task rejects', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('OOM'))));
    await expect(embedText('fail case')).rejects.toThrow('OOM');
  });

  it('throws WorkerBus v2 unavailable without enqueuing when the pool is unavailable', async () => {
    mockEnsureInferencePool.mockResolvedValue(null);
    await expect(embedText('fail case 2')).rejects.toThrow('WorkerBus v2 unavailable');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('truncates input silently when text exceeds 512 chars', async () => {
    await embedText('a'.repeat(600));
    expect(requestCalls[0]?.input.length).toBe(512);
  });

  it('does not truncate input at exactly 512 chars', async () => {
    await embedText('b'.repeat(512));
    expect(requestCalls[0]?.input.length).toBe(512);
  });

  it('enqueues inference.embed with the feature-extraction task and inference.embed capability', async () => {
    await embedText('test');
    expect(requestCalls[0]?.task).toBe('feature-extraction');
    expect(mockEnqueue).toHaveBeenCalledWith(
      'inference.embed',
      expect.anything(),
      expect.objectContaining({ capabilities: ['inference.embed'] }),
    );
  });

  it('returns the cached vector on a second call for the same text without re-enqueuing', async () => {
    const first = await embedText('cache me');
    const second = await embedText('cache me');
    expect(second).toBe(first);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });
});

// ─── embedBatch ─────────────────────────────────────────────────────────────

describe('embedBatch', () => {
  it('returns an array of Float32Arrays, one per input', async () => {
    nextResult = [0.5, 0.5];
    const results = await embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toBeInstanceOf(Float32Array);
    }
  });

  it('returns correct count for 9 texts (spans two micro-batches of 8+1)', async () => {
    nextResult = [0.1, 0.2];
    const texts = Array.from({ length: 9 }, (_, i) => `text-${i}`);
    const results = await embedBatch(texts);
    expect(results).toHaveLength(9);
  });

  it('sends exactly N enqueue calls for N input texts', async () => {
    nextResult = [0.1, 0.2];
    await embedBatch(['x', 'y', 'z']);
    expect(requestCalls).toHaveLength(3);
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
