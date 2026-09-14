/**
 * Tests for services/lora/loraEvaluationService.ts
 * QNBS-v3: Style Consistency Score math and label classification.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock embedding service to return controlled vectors
vi.mock('../../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockImplementation(async (text: string) => {
    // Return different vectors for different input patterns
    if (text.startsWith('base')) return new Float32Array(384).fill(0.3);
    if (text.startsWith('adapt')) return new Float32Array(384).fill(0.9);
    if (text.startsWith('prompt')) return new Float32Array(384).fill(0.8);
    return new Float32Array(384).fill(0.5);
  }),
}));

import {
  comparePromptOutputs,
  computeStyleConsistencyScore,
  scoreLabel,
} from '../../../services/lora/loraEvaluationService';

describe('scoreLabel', () => {
  it('returns excellent for score >= 0.85', () => {
    expect(scoreLabel(0.9)).toBe('excellent');
    expect(scoreLabel(0.85)).toBe('excellent');
  });
  it('returns good for 0.7–0.85', () => {
    expect(scoreLabel(0.75)).toBe('good');
  });
  it('returns partial for 0.5–0.7', () => {
    expect(scoreLabel(0.6)).toBe('partial');
  });
  it('returns weak for < 0.5', () => {
    expect(scoreLabel(0.3)).toBe('weak');
  });
});

describe('computeStyleConsistencyScore', () => {
  it('returns zero report for empty input', async () => {
    const report = await computeStyleConsistencyScore([]);
    expect(report.score).toBe(0);
    expect(report.sampleComparisons).toHaveLength(0);
  });

  it('returns report with score and sampleComparisons', async () => {
    const prompts = [
      {
        prompt: 'prompt: describe the sea',
        baseOutput: 'base: calm waves',
        adaptedOutput: 'adapt: silver waves shimmered',
      },
    ];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
    expect(report.sampleComparisons).toHaveLength(1);
    expect(report.sampleComparisons[0]!.prompt).toBe('prompt: describe the sea');
  });

  it('caps sampleComparisons at 5', async () => {
    const prompts = Array.from({ length: 10 }, (_, i) => ({
      prompt: `prompt ${i}`,
      baseOutput: `base ${i}`,
      adaptedOutput: `adapt ${i}`,
    }));
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.sampleComparisons.length).toBeLessThanOrEqual(5);
  });
});

describe('comparePromptOutputs', () => {
  it('returns numeric similarities between 0 and 1', async () => {
    const result = await comparePromptOutputs(
      'prompt: write',
      'base: something',
      'adapt: something better',
    );
    expect(result.baseSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.adaptedSimilarity).toBeGreaterThanOrEqual(0);
    expect(typeof result.improvement).toBe('number');
  });
});
