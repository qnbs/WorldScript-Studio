import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: [localNlpService now routes through WorkerBus v2 — mock ensureInferencePool() instead of the global Worker constructor. Consolidates the former tests/unit/services/localNlpService.test.ts, which duplicated most of this coverage.]

const { mockEnqueue, mockEnsureInferencePool } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnsureInferencePool: vi.fn(),
}));

vi.mock('../../services/workerBusManager', () => ({
  ensureInferencePool: mockEnsureInferencePool,
}));

const { analyzeSentiment, classifyWritingTopic, summarizeText } = await import(
  '../../services/ai/localNlpService'
);

function makeHandle(result: Promise<unknown>) {
  return { taskId: 't1', result, progress: (async function* () {})(), cancel: vi.fn() };
}

function makeBus() {
  return { enqueue: mockEnqueue };
}

let requestCalls: Array<{
  task: string;
  modelId: string;
  input: string;
  inferenceOptions?: Record<string, unknown>;
}> = [];
let nextResult = 'POSITIVE:0.95';

beforeEach(() => {
  vi.clearAllMocks();
  requestCalls = [];
  nextResult = 'POSITIVE:0.95';
  mockEnsureInferencePool.mockResolvedValue(makeBus());
  mockEnqueue.mockImplementation((_taskType: string, payload: unknown) => {
    requestCalls.push(payload as (typeof requestCalls)[number]);
    return makeHandle(Promise.resolve(nextResult));
  });
});

// ─── analyzeSentiment ────────────────────────────────────────────────────────

describe('analyzeSentiment', () => {
  it('parses POSITIVE result correctly', async () => {
    nextResult = 'POSITIVE:0.95';
    const r = await analyzeSentiment('I love writing!');
    expect(r.label).toBe('POSITIVE');
    expect(r.score).toBeCloseTo(0.95, 3);
    expect(r.normalized).toBeCloseTo(0.95, 3);
  });

  it('parses NEGATIVE result correctly', async () => {
    nextResult = 'NEGATIVE:0.88';
    const r = await analyzeSentiment('I hate this.');
    expect(r.label).toBe('NEGATIVE');
    expect(r.score).toBeCloseTo(0.88, 3);
    expect(r.normalized).toBeCloseTo(-0.88, 3);
  });

  it('parses NEUTRAL result with normalized = 0', async () => {
    nextResult = 'NEUTRAL:0.6';
    const r = await analyzeSentiment('The document exists.');
    expect(r.label).toBe('NEUTRAL');
    expect(r.normalized).toBe(0);
  });

  it('returns NEUTRAL fallback when the task rejects', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('OOM'))));
    const r = await analyzeSentiment('anything');
    expect(r.label).toBe('NEUTRAL');
    expect(r.score).toBe(0.5);
    expect(r.normalized).toBe(0);
  });

  it('caps input text to 512 chars before enqueuing', async () => {
    await analyzeSentiment('x'.repeat(600));
    expect(requestCalls[0]?.input.length).toBe(512);
  });

  it('maps an unknown label to NEUTRAL', async () => {
    nextResult = 'GARBAGE:0.7';
    const r = await analyzeSentiment('weird text');
    expect(r.label).toBe('NEUTRAL');
    expect(r.normalized).toBe(0);
  });

  it('returns NEUTRAL fallback when the WorkerBus pool is unavailable', async () => {
    mockEnsureInferencePool.mockResolvedValue(null);
    const r = await analyzeSentiment('anything');
    expect(r.label).toBe('NEUTRAL');
    expect(r.score).toBe(0.5);
    expect(r.normalized).toBe(0);
  });

  it('defaults score to 0.5 when the worker omits the ":score" suffix', async () => {
    nextResult = 'POSITIVE';
    const r = await analyzeSentiment('no score suffix');
    expect(r.label).toBe('POSITIVE');
    expect(r.score).toBe(0.5);
  });

  it('enqueues inference.text with the inference.text capability', async () => {
    await analyzeSentiment('test');
    expect(requestCalls[0]?.task).toBe('sentiment-analysis');
    expect(mockEnqueue).toHaveBeenCalledWith(
      'inference.text',
      expect.anything(),
      expect.objectContaining({ capabilities: ['inference.text'] }),
    );
  });

  it('omits the inferenceOptions key entirely when none is passed (exactOptionalPropertyTypes)', async () => {
    await analyzeSentiment('test');
    expect(Object.hasOwn(requestCalls[0] ?? {}, 'inferenceOptions')).toBe(false);
  });
});

// ─── summarizeText ────────────────────────────────────────────────────────────

describe('summarizeText', () => {
  it('returns the worker result on success', async () => {
    nextResult = 'Short summary.';
    const result = await summarizeText('A long piece of text about storytelling and craft.');
    expect(result).toBe('Short summary.');
  });

  it('falls back to text.slice(0, 280) when the task rejects', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('unavailable'))));
    const text = 'b'.repeat(400);
    const result = await summarizeText(text);
    expect(result).toBe(text.slice(0, 280));
  });

  it('caps input to 1024 chars before enqueuing', async () => {
    await summarizeText('c'.repeat(2000));
    expect(requestCalls[0]?.input.length).toBe(1024);
  });

  it('passes max_new_tokens from the maxLength param', async () => {
    await summarizeText('some text', 200);
    expect(requestCalls[0]?.inferenceOptions?.['max_new_tokens']).toBe(200);
  });
});

// ─── classifyWritingTopic ─────────────────────────────────────────────────────

describe('classifyWritingTopic', () => {
  it('returns Fantasy for fantasy-keyword text', async () => {
    const result = await classifyWritingTopic('The dragon soared over the realm with magic.');
    expect(result).toBe('Fantasy');
  });

  it('returns SciFi for sci-fi keyword text', async () => {
    const result = await classifyWritingTopic('The android pilot navigated the galaxy.');
    expect(result).toBe('SciFi');
  });

  it('returns Thriller for thriller keyword text', async () => {
    const result = await classifyWritingTopic(
      'The detective uncovered the conspiracy and the crime.',
    );
    expect(result).toBe('Thriller');
  });

  it('returns Romance for romance keyword text', async () => {
    const result = await classifyWritingTopic('Their love grew after the kiss at the wedding.');
    expect(result).toBe('Romance');
  });

  it('returns Horror for horror keyword text', async () => {
    const result = await classifyWritingTopic('The ghost haunted the dark mansion with terror.');
    expect(result).toBe('Horror');
  });

  it('returns Mystery for mystery keyword text', async () => {
    const result = await classifyWritingTopic(
      'The detective followed every clue to investigate the mystery.',
    );
    expect(result).toBe('Mystery');
  });

  it('returns General Fiction when no genre keywords match', async () => {
    const result = await classifyWritingTopic('The sun rose over the quiet village.');
    expect(result).toBe('General Fiction');
  });

  it('picks the genre with the highest keyword count (multi-keyword dominant)', async () => {
    // Fantasy: dragon, magic, wizard, elf, quest (5) vs SciFi: spaceship (1)
    const result = await classifyWritingTopic(
      'The dragon, wizard, and elf went on a quest with magic on a spaceship.',
    );
    expect(result).toBe('Fantasy');
  });

  it('classification is case-insensitive', async () => {
    const result = await classifyWritingTopic('THE DRAGON SOARED WITH MAGIC.');
    expect(result).toBe('Fantasy');
  });
});
