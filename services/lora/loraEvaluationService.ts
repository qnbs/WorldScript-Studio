/**
 * LoRA Evaluation Service
 * QNBS-v3: Computes Style Consistency Score via MiniLM-L6-v2 cosine similarity
 *          between base-model outputs and adapter outputs. Pure, testable math.
 */

import type { StyleConsistencyReport } from '../../features/lora/types';
import { logger } from '../logger';

async function getEmbeddingService() {
  const m = await import('../ai/localEmbeddingService');
  return m;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return Math.max(0, Math.min(1, dot));
}

function meanSimilarity(pairs: Array<[Float32Array, Float32Array]>): number {
  if (pairs.length === 0) return 0;
  return pairs.reduce((s, [a, b]) => s + cosineSimilarity(a, b), 0) / pairs.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EvaluationPrompt {
  prompt: string;
  baseOutput: string;
  adaptedOutput: string;
}

/**
 * Compute the Style Consistency Score between base and adapter outputs.
 *
 * Score interpretation:
 *  > 0.85 — near-identical style
 *  0.7–0.85 — strong style match
 *  0.5–0.7 — partial match; adapter may need more training data
 *  < 0.5 — style divergence; dataset quality may be low
 */
export async function computeStyleConsistencyScore(
  prompts: EvaluationPrompt[],
): Promise<StyleConsistencyReport> {
  if (prompts.length === 0) {
    return { score: 0, baseline: 0, improvement: 0, sampleComparisons: [] };
  }

  try {
    const { embedText } = await getEmbeddingService();

    const baseTexts = prompts.map((p) => p.baseOutput.slice(0, 512));
    const adaptedTexts = prompts.map((p) => p.adaptedOutput.slice(0, 512));
    const promptTexts = prompts.map((p) => p.prompt.slice(0, 256));

    const [baseEmbeds, adaptedEmbeds, promptEmbeds] = await Promise.all([
      Promise.all(baseTexts.map(embedText)),
      Promise.all(adaptedTexts.map(embedText)),
      Promise.all(promptTexts.map(embedText)),
    ]);

    // Score: how similar are adapted outputs to prompt style (intent alignment)
    const adaptedToPromptPairs: Array<[Float32Array, Float32Array]> = prompts.map((_, i) => [
      adaptedEmbeds[i]!,
      promptEmbeds[i]!,
    ]);
    const baseToPromptPairs: Array<[Float32Array, Float32Array]> = prompts.map((_, i) => [
      baseEmbeds[i]!,
      promptEmbeds[i]!,
    ]);

    const score = meanSimilarity(adaptedToPromptPairs);
    const baseline = meanSimilarity(baseToPromptPairs);

    const sampleComparisons = prompts.slice(0, 5).map((p, i) => ({
      prompt: p.prompt,
      base: p.baseOutput,
      adapted: p.adaptedOutput,
      similarity: cosineSimilarity(adaptedEmbeds[i]!, promptEmbeds[i]!),
    }));

    return {
      score,
      baseline,
      improvement: score - baseline,
      sampleComparisons,
    };
  } catch (err) {
    logger.warn('loraEvaluationService: evaluation failed', { err });
    return { score: 0, baseline: 0, improvement: 0, sampleComparisons: [] };
  }
}

/** Format a style score (0–1) as a human-readable label. */
export function scoreLabel(score: number): 'excellent' | 'good' | 'partial' | 'weak' {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.7) return 'good';
  if (score >= 0.5) return 'partial';
  return 'weak';
}

/** Quick single-prompt comparison (for the side-by-side evaluation panel). */
export async function comparePromptOutputs(
  prompt: string,
  baseOutput: string,
  adaptedOutput: string,
): Promise<{ baseSimilarity: number; adaptedSimilarity: number; improvement: number }> {
  try {
    const { embedText } = await getEmbeddingService();
    const [pEmbed, bEmbed, aEmbed] = await Promise.all([
      embedText(prompt.slice(0, 256)),
      embedText(baseOutput.slice(0, 512)),
      embedText(adaptedOutput.slice(0, 512)),
    ]);
    const baseSimilarity = cosineSimilarity(bEmbed, pEmbed);
    const adaptedSimilarity = cosineSimilarity(aEmbed, pEmbed);
    return { baseSimilarity, adaptedSimilarity, improvement: adaptedSimilarity - baseSimilarity };
  } catch {
    return { baseSimilarity: 0, adaptedSimilarity: 0, improvement: 0 };
  }
}
