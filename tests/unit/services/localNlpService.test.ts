/**
 * Tests for services/ai/localNlpService.ts
 * QNBS-v3: Tests classifyWritingTopic (pure keyword matching) and the worker-path functions
 *          with a mocked Worker that returns controlled responses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

class MockWorker {
  private handlers: ((event: MessageEvent) => void)[] = [];

  postMessage(data: { messageId: string; task: string }) {
    // Simulate async response
    const responseData = {
      messageId: data.messageId,
      ok: true,
      result: 'POSITIVE:0.9',
    };
    setTimeout(() => {
      for (const h of this.handlers) {
        h(new MessageEvent('message', { data: responseData }));
      }
    }, 0);
  }

  addEventListener(_type: string, handler: (event: MessageEvent) => void) {
    this.handlers.push(handler);
  }

  removeEventListener(_type: string, handler: (event: MessageEvent) => void) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  terminate() {
    this.handlers = [];
  }
}

vi.stubGlobal('Worker', MockWorker);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  _resetWorkerForTest,
  analyzeSentiment,
  classifyWritingTopic,
} from '../../../services/ai/localNlpService';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyWritingTopic', () => {
  it('classifies dragon-related text as Fantasy', async () => {
    const result = await classifyWritingTopic('The dragon soared over the magical realm');
    expect(result).toBe('Fantasy');
  });

  it('classifies space-related text as SciFi', async () => {
    const result = await classifyWritingTopic('The spaceship launched into the alien galaxy');
    expect(result).toBe('SciFi');
  });

  it('classifies thriller keywords', async () => {
    const result = await classifyWritingTopic('The detective uncovered a conspiracy and murder');
    expect(result).toBe('Thriller');
  });

  it('classifies romance keywords', async () => {
    const result = await classifyWritingTopic(
      'Their love blossomed and they shared a kiss at the wedding',
    );
    expect(result).toBe('Romance');
  });

  it('returns General Fiction when no keywords match', async () => {
    const result = await classifyWritingTopic('She walked to the store and bought bread.');
    expect(result).toBe('General Fiction');
  });

  it('picks the genre with the most keyword matches', async () => {
    // 2 Fantasy keywords vs 1 SciFi
    const result = await classifyWritingTopic('A dragon and a wizard met a robot');
    expect(result).toBe('Fantasy');
  });

  it('is case-insensitive', async () => {
    const result = await classifyWritingTopic('DRAGON AND MAGIC');
    expect(result).toBe('Fantasy');
  });
});

describe('analyzeSentiment', () => {
  afterEach(() => {
    _resetWorkerForTest();
  });

  it('returns parsed sentiment from worker response', async () => {
    const result = await analyzeSentiment('This is wonderful!');
    expect(result.label).toBe('POSITIVE');
    expect(result.score).toBe(0.9);
    expect(result.normalized).toBeCloseTo(0.9);
  });
});
