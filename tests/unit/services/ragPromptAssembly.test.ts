/**
 * Tests for services/ragPromptAssembly.ts (pure exported helpers only)
 * QNBS-v3: estimateTokens, deduplicateChunksBySection, buildRAGContextBlock — no AI/IDB deps.
 */

import { describe, expect, it } from 'vitest';
import type { RagChunk } from '../../../services/localRagService';
import {
  buildRAGContextBlock,
  deduplicateChunksBySection,
  estimateTokens,
} from '../../../services/ragPromptAssembly';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(sectionId: string, chunkIndex: number, score: number, text: string): RagChunk {
  return { sectionId, chunkIndex, score, text, indexedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates token count as ceil((len/4)*1.3)', () => {
    const text = 'Hello World'; // length 11
    // (11/4)*1.3 = 3.575 → ceil = 4
    expect(estimateTokens(text)).toBe(4);
  });

  it('increases with text length', () => {
    const short = 'short';
    const long = 'a'.repeat(100);
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });
});

describe('deduplicateChunksBySection', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateChunksBySection([])).toEqual([]);
  });

  it('keeps highest-score chunk per section', () => {
    const chunks = [
      makeChunk('s1', 0, 0.5, 'low score'),
      makeChunk('s1', 1, 0.9, 'high score'),
      makeChunk('s1', 2, 0.7, 'mid score'),
    ];
    const result = deduplicateChunksBySection(chunks);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('high score');
  });

  it('keeps one chunk per section when multiple sections', () => {
    const chunks = [
      makeChunk('s1', 0, 0.8, 'sec1 high'),
      makeChunk('s1', 1, 0.3, 'sec1 low'),
      makeChunk('s2', 0, 0.6, 'sec2 only'),
    ];
    const result = deduplicateChunksBySection(chunks);
    expect(result).toHaveLength(2);
  });

  it('sorts by score descending', () => {
    const chunks = [
      makeChunk('s1', 0, 0.5, 'sec1'),
      makeChunk('s2', 0, 0.9, 'sec2'),
      makeChunk('s3', 0, 0.7, 'sec3'),
    ];
    const result = deduplicateChunksBySection(chunks);
    expect(result[0]?.score).toBe(0.9);
    expect(result[1]?.score).toBe(0.7);
    expect(result[2]?.score).toBe(0.5);
  });
});

describe('buildRAGContextBlock', () => {
  it('returns empty string for no chunks', () => {
    expect(buildRAGContextBlock([], undefined, 1000)).toBe('');
  });

  it('includes chunk header with section id when no manuscript', () => {
    const chunks = [makeChunk('sec-1', 0, 0.9, 'Some context text.')];
    const result = buildRAGContextBlock(chunks, undefined, 1000);
    expect(result).toContain('sec-1');
    expect(result).toContain('Some context text.');
  });

  it('uses section title from manuscript', () => {
    const chunks = [makeChunk('sec-1', 0, 0.9, 'Some context text.')];
    const manuscript = [
      { id: 'sec-1', title: 'Chapter One', content: '', wordCount: 0, type: 'scene', order: 0 },
    ] as never;
    const result = buildRAGContextBlock(chunks, manuscript, 1000);
    expect(result).toContain('Chapter One');
  });

  it('stops adding chunks when token budget is exhausted', () => {
    // Each chunk has a long body; budget allows exactly one chunk (header+500 chars ≈ 173 tokens)
    const longText = 'a'.repeat(500);
    const chunks = [
      makeChunk('s1', 0, 0.9, longText),
      makeChunk('s2', 0, 0.8, longText),
      makeChunk('s3', 0, 0.7, longText),
    ];
    // QNBS-v3: budget=200 allows first chunk (~173 tokens) but not a second (346 total > 200)
    const result = buildRAGContextBlock(chunks, undefined, 200);
    expect(result).toContain('s1');
    expect(result).not.toContain('s2');
  });

  it('separates multiple chunks with ---', () => {
    const chunks = [
      makeChunk('s1', 0, 0.9, 'First chunk.'),
      makeChunk('s2', 0, 0.8, 'Second chunk.'),
    ];
    const result = buildRAGContextBlock(chunks, undefined, 10000);
    expect(result).toContain('---');
  });

  it('includes score in header', () => {
    const chunks = [makeChunk('s1', 0, 0.75, 'text')];
    const result = buildRAGContextBlock(chunks, undefined, 1000);
    expect(result).toContain('0.75');
  });
});
