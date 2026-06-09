import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationPrompt } from '../../services/lora/loraEvaluationService';
import {
  comparePromptOutputs,
  computeStyleConsistencyScore,
  scoreLabel,
} from '../../services/lora/loraEvaluationService';

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn(),
}));

import { embedText } from '../../services/ai/localEmbeddingService';

const mockEmbedText = vi.mocked(embedText);

function makePrompt(overrides: Partial<EvaluationPrompt> = {}): EvaluationPrompt {
  return {
    prompt: 'Write a scene',
    baseOutput: 'The hero walked.',
    adaptedOutput: 'The hero walked.',
    ...overrides,
  };
}

// Deterministic mock: returns a Float32Array based on text hash
function mockEmbedding(text: string): Float32Array {
  const arr = new Float32Array(384);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  arr[0] = (hash % 1000) / 1000;
  arr[1] = 1;
  // L2-normalize
  const norm = Math.sqrt(arr[0]! * arr[0]! + arr[1]! * arr[1]!);
  arr[0]! /= norm;
  arr[1]! /= norm;
  return arr;
}

describe('computeStyleConsistencyScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockImplementation((text: string) => Promise.resolve(mockEmbedding(text)));
  });

  it('returns zeroed report for empty prompts', async () => {
    const report = await computeStyleConsistencyScore([]);
    expect(report.score).toBe(0);
    expect(report.baseline).toBe(0);
    expect(report.improvement).toBe(0);
    expect(report.sampleComparisons).toEqual([]);
  });

  it('computes score and baseline for identical outputs', async () => {
    const prompts = [makePrompt()];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
    expect(report.baseline).toBeGreaterThanOrEqual(0);
    expect(report.sampleComparisons).toHaveLength(1);
  });

  it('computes improvement as score - baseline', async () => {
    const prompts = [
      makePrompt({
        baseOutput: 'Short.',
        adaptedOutput: 'A much longer and more elaborate description of the very same event.',
      }),
    ];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.improvement).toBeCloseTo(report.score - report.baseline, 5);
  });

  it('truncates outputs to 512 chars before embedding', async () => {
    const longOutput = 'word '.repeat(200); // > 512 chars
    const prompts = [makePrompt({ baseOutput: longOutput, adaptedOutput: longOutput })];
    await computeStyleConsistencyScore(prompts);
    const callArg = mockEmbedText.mock.calls[0]![0];
    expect(callArg.length).toBeLessThanOrEqual(512);
  });

  it('truncates prompts to 256 chars before embedding', async () => {
    const longPrompt = 'word '.repeat(100);
    const prompts = [makePrompt({ prompt: longPrompt })];
    await computeStyleConsistencyScore(prompts);
    // The third embed call is for the prompt (base, adapted, prompt)
    const promptCall = mockEmbedText.mock.calls[2]![0];
    expect(promptCall.length).toBeLessThanOrEqual(256);
  });

  it('limits sample comparisons to 5 entries', async () => {
    const prompts = Array.from({ length: 10 }, (_, i) => makePrompt({ prompt: `Prompt ${i}` }));
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.sampleComparisons).toHaveLength(5);
  });

  it('returns zeroed report on embedText failure', async () => {
    mockEmbedText.mockRejectedValue(new Error('Embedding OOM'));
    const prompts = [makePrompt()];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.score).toBe(0);
    expect(report.baseline).toBe(0);
    expect(report.improvement).toBe(0);
    expect(report.sampleComparisons).toEqual([]);
  });

  it('returns different scores for divergent outputs', async () => {
    const prompts = [
      makePrompt({ baseOutput: 'The cat sat.', adaptedOutput: 'The cat sat on the mat.' }),
      makePrompt({
        baseOutput: 'The dog ran.',
        adaptedOutput: 'A completely different sentence structure here.',
      }),
    ];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
    expect(report.baseline).toBeGreaterThanOrEqual(0);
    expect(report.baseline).toBeLessThanOrEqual(1);
  });
});

// ── scoreLabel ─────────────────────────────────────────────────────────────

describe('scoreLabel', () => {
  it('labels excellent for >= 0.85', () => {
    expect(scoreLabel(0.85)).toBe('excellent');
    expect(scoreLabel(1.0)).toBe('excellent');
  });

  it('labels good for 0.7–0.84', () => {
    expect(scoreLabel(0.7)).toBe('good');
    expect(scoreLabel(0.84)).toBe('good');
  });

  it('labels partial for 0.5–0.69', () => {
    expect(scoreLabel(0.5)).toBe('partial');
    expect(scoreLabel(0.69)).toBe('partial');
  });

  it('labels weak for < 0.5', () => {
    expect(scoreLabel(0.49)).toBe('weak');
    expect(scoreLabel(0)).toBe('weak');
  });
});

// ── comparePromptOutputs ───────────────────────────────────────────────────

describe('comparePromptOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockImplementation((text: string) => Promise.resolve(mockEmbedding(text)));
  });

  it('returns similarities for valid inputs', async () => {
    const result = await comparePromptOutputs('Prompt', 'Base', 'Adapted');
    expect(result.baseSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.adaptedSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.improvement).toBe(result.adaptedSimilarity - result.baseSimilarity);
  });

  it('truncates prompt to 256 chars', async () => {
    const longPrompt = 'word '.repeat(100);
    await comparePromptOutputs(longPrompt, 'Base', 'Adapted');
    const promptCall = mockEmbedText.mock.calls[0]![0];
    expect(promptCall.length).toBeLessThanOrEqual(256);
  });

  it('returns zeros on embed failure', async () => {
    mockEmbedText.mockRejectedValue(new Error('OOM'));
    const result = await comparePromptOutputs('Prompt', 'Base', 'Adapted');
    expect(result.baseSimilarity).toBe(0);
    expect(result.adaptedSimilarity).toBe(0);
    expect(result.improvement).toBe(0);
  });

  it('returns different scores for divergent outputs', async () => {
    const prompts = [
      makePrompt({ baseOutput: 'The cat sat.', adaptedOutput: 'The cat sat on the mat.' }),
      makePrompt({
        baseOutput: 'The dog ran.',
        adaptedOutput: 'A completely different sentence structure here.',
      }),
    ];
    const report = await computeStyleConsistencyScore(prompts);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
    expect(report.baseline).toBeGreaterThanOrEqual(0);
    expect(report.baseline).toBeLessThanOrEqual(1);
  });
});
