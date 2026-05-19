import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Arrow functions cannot be constructors — use hoisted vi.fn() refs + class stub.
const workerPostMessage = vi.hoisted(() => vi.fn());
const workerAddEventListener = vi.hoisted(() => vi.fn());
const workerRemoveEventListener = vi.hoisted(() => vi.fn());
const workerTerminate = vi.hoisted(() => vi.fn());

// QNBS-v3: Class-based Worker stub so `new Worker(...)` in source doesn't throw.
class MockWorker {
  postMessage = workerPostMessage;
  addEventListener = workerAddEventListener;
  removeEventListener = workerRemoveEventListener;
  terminate = workerTerminate;
}

vi.stubGlobal('Worker', MockWorker);

import {
  _resetWorkerForTest,
  analyzeSentiment,
  classifyWritingTopic,
  summarizeText,
} from '../../services/ai/localNlpService';

beforeEach(() => {
  _resetWorkerForTest();
  workerPostMessage.mockReset();
  workerAddEventListener.mockReset();
  workerRemoveEventListener.mockReset();
});

afterEach(() => {
  _resetWorkerForTest();
});

// Helper: fire the message handler captured by the last addEventListener call
function resolveWorkerMessage(responseOverride?: {
  ok?: boolean;
  result?: string | undefined;
  error?: string;
}) {
  const [, handler] =
    workerAddEventListener.mock.calls[workerAddEventListener.mock.calls.length - 1] ?? [];
  if (typeof handler !== 'function') throw new Error('No handler registered');

  const lastMsg = workerPostMessage.mock.calls[workerPostMessage.mock.calls.length - 1]?.[0] as {
    messageId: string;
  };

  handler({
    data: {
      messageId: lastMsg?.messageId ?? 'nlp-test',
      ok: true,
      result: 'POSITIVE:0.95',
      ...responseOverride,
    },
  } as MessageEvent);
}

// ─── analyzeSentiment ──────────────────────────────────────────────────────────

describe('analyzeSentiment', () => {
  it('parses POSITIVE result correctly', async () => {
    const promise = analyzeSentiment('I love writing!');
    resolveWorkerMessage({ result: 'POSITIVE:0.95' });
    const r = await promise;
    expect(r.label).toBe('POSITIVE');
    expect(r.score).toBeCloseTo(0.95, 3);
    expect(r.normalized).toBeCloseTo(0.95, 3);
  });

  it('parses NEGATIVE result correctly', async () => {
    const promise = analyzeSentiment('I hate this.');
    resolveWorkerMessage({ result: 'NEGATIVE:0.88' });
    const r = await promise;
    expect(r.label).toBe('NEGATIVE');
    expect(r.score).toBeCloseTo(0.88, 3);
    expect(r.normalized).toBeCloseTo(-0.88, 3);
  });

  it('parses NEUTRAL result with normalized = 0', async () => {
    const promise = analyzeSentiment('The document exists.');
    resolveWorkerMessage({ result: 'NEUTRAL:0.6' });
    const r = await promise;
    expect(r.label).toBe('NEUTRAL');
    expect(r.normalized).toBe(0);
  });

  it('returns NEUTRAL fallback on worker error', async () => {
    const promise = analyzeSentiment('anything');
    resolveWorkerMessage({ ok: false, result: undefined, error: 'OOM' });
    const r = await promise;
    expect(r.label).toBe('NEUTRAL');
    expect(r.score).toBe(0.5);
    expect(r.normalized).toBe(0);
  });

  it('returns NEUTRAL fallback on empty result', async () => {
    const promise = analyzeSentiment('anything');
    resolveWorkerMessage({ ok: true, result: undefined });
    const r = await promise;
    expect(r.label).toBe('NEUTRAL');
  });

  it('caps input text to 512 chars before sending', async () => {
    const promise = analyzeSentiment('x'.repeat(600));
    resolveWorkerMessage();
    await promise;
    const posted = workerPostMessage.mock.calls[0]?.[0] as { input: string };
    expect(posted.input.length).toBe(512);
  });

  it('maps unknown label to NEUTRAL', async () => {
    const promise = analyzeSentiment('weird text');
    resolveWorkerMessage({ result: 'GARBAGE:0.7' });
    const r = await promise;
    expect(r.label).toBe('NEUTRAL');
    expect(r.normalized).toBe(0);
  });
});

// ─── summarizeText ──────────────────────────────────────────────────────────

describe('summarizeText', () => {
  it('returns worker result on success', async () => {
    const promise = summarizeText('A long piece of text about storytelling and craft.');
    resolveWorkerMessage({ result: 'Short summary.' });
    const result = await promise;
    expect(result).toBe('Short summary.');
  });

  it('falls back to text.slice(0, 280) when worker fails', async () => {
    const text = 'b'.repeat(400);
    const promise = summarizeText(text);
    resolveWorkerMessage({ ok: false, result: undefined });
    const result = await promise;
    expect(result).toBe(text.slice(0, 280));
  });

  it('caps input to 1024 chars before sending to worker', async () => {
    const promise = summarizeText('c'.repeat(2000));
    resolveWorkerMessage({ result: 'ok' });
    await promise;
    const posted = workerPostMessage.mock.calls[0]?.[0] as { input: string };
    expect(posted.input.length).toBe(1024);
  });

  it('passes max_new_tokens option from maxLength param', async () => {
    const promise = summarizeText('some text', 200);
    resolveWorkerMessage({ result: 'ok' });
    await promise;
    const posted = workerPostMessage.mock.calls[0]?.[0] as {
      inferenceOptions: { max_new_tokens: number };
    };
    expect(posted.inferenceOptions.max_new_tokens).toBe(200);
  });
});

// ─── classifyWritingTopic ────────────────────────────────────────────────────

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
