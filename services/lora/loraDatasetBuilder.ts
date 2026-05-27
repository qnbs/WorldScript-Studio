/**
 * LoRA Dataset Builder
 * QNBS-v3: Extracts scene pairs from IDB manuscript, scores quality via MiniLM embeddings,
 *          generates synthetic pairs via AI, and exports JSONL in Alpaca/ChatML/ShareGPT format.
 */

import { v4 as uuid } from 'uuid';
import type { DatasetEntry, DatasetFormat, DatasetQualityReport } from '../../features/lora/types';
import { generateText as geminiGenerateText } from '../geminiService';
import { logger } from '../logger';

// Lazy-loaded so localEmbeddingService doesn't block cold start
async function getEmbeddingService() {
  const m = await import('../ai/localEmbeddingService');
  return m;
}

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

const QUALITY_ACCEPT_THRESHOLD = 0.4;
const QUALITY_FLAG_THRESHOLD = 0.6;
const MIN_WORD_COUNT = 30;
const MAX_WORD_COUNT = 600;

/** Cosine similarity between two L2-normalized Float32Arrays. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  // Vectors from MiniLM-L6-v2 are already L2-normalized, so dot product == cosine similarity
  return Math.max(0, Math.min(1, dot));
}

/** Compute a corpus centroid as the element-wise mean of all embedding vectors. */
function computeCentroid(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(384);
  const dim = embeddings[0]!.length;
  const centroid = new Float32Array(dim);
  for (const vec of embeddings) {
    for (let i = 0; i < dim; i++) centroid[i]! += vec[i]!;
  }
  for (let i = 0; i < dim; i++) centroid[i]! /= embeddings.length;
  return centroid;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Scene pair extraction
// ---------------------------------------------------------------------------

interface RawSection {
  id: string;
  title?: string;
  content?: string;
}

/** Extract Alpaca-style (instruction, input, output) triples from project sections. */
export async function extractScenePairs(projectId: string): Promise<DatasetEntry[]> {
  let sections: RawSection[] = [];
  try {
    const { storageService } = await import('../storageService');
    const project = await storageService.loadProject(projectId);
    sections = (project?.manuscript as RawSection[] | undefined) ?? [];
  } catch (err) {
    logger.warn('loraDatasetBuilder: failed to load project sections', { err });
    return [];
  }

  const entries: DatasetEntry[] = [];
  for (const section of sections) {
    const text = section.content ?? '';
    const wordCount = countWords(text);
    if (wordCount < MIN_WORD_COUNT || wordCount > MAX_WORD_COUNT) continue;

    const title = section.title ?? 'Scene';
    entries.push({
      id: uuid(),
      projectId,
      instruction: `Continue this scene from "${title}" in the same narrative voice and style.`,
      input: text.slice(0, Math.floor(text.length * 0.6)),
      output: text.slice(Math.floor(text.length * 0.6)),
      source: 'extracted',
      qualityScore: 0, // filled in by scoreDatasetEntries
      wordCount,
      createdAt: Date.now(),
    });
  }
  return entries;
}

/** Score a batch of dataset entries against the corpus centroid (in-place). */
export async function scoreDatasetEntries(entries: DatasetEntry[]): Promise<DatasetEntry[]> {
  if (entries.length === 0) return entries;
  try {
    const { embedText } = await getEmbeddingService();
    const texts = entries.map((e) => `${e.instruction} ${e.output}`.slice(0, 512));
    const embeddings = await Promise.all(texts.map((t) => embedText(t)));
    const centroid = computeCentroid(embeddings);
    return entries.map((entry, i) => ({
      ...entry,
      qualityScore: cosineSimilarity(embeddings[i]!, centroid),
    }));
  } catch (err) {
    logger.warn('loraDatasetBuilder: scoring failed, defaulting to 0.5', { err });
    return entries.map((e) => ({ ...e, qualityScore: 0.5 }));
  }
}

export async function scoreDatasetEntry(entry: DatasetEntry): Promise<number> {
  const [scored] = await scoreDatasetEntries([entry]);
  return scored?.qualityScore ?? 0.5;
}

// ---------------------------------------------------------------------------
// Synthetic data generation
// ---------------------------------------------------------------------------

/** Generate synthetic Alpaca pairs by paraphrasing seed entries via AI provider. */
export async function generateSyntheticPairs(
  seed: DatasetEntry[],
  count: number,
  signal: AbortSignal,
): Promise<DatasetEntry[]> {
  const results: DatasetEntry[] = [];
  const batchSeed = seed.slice(0, Math.min(seed.length, 10));

  for (let i = 0; i < Math.min(count, 50) && !signal.aborted; i++) {
    const source = batchSeed[i % batchSeed.length];
    if (!source) continue;
    const prompt = `You are a writing-style analyst. Given this story excerpt, create ONE alternative version that preserves the author's voice, sentence rhythm, and vocabulary but changes events and details. Output ONLY the new passage, no preamble.

ORIGINAL:
${source.output.slice(0, 500)}`;
    try {
      const output = await geminiGenerateText(prompt, 'Balanced', signal);
      if (!output || output.length < 80) continue;
      results.push({
        id: uuid(),
        projectId: source.projectId,
        instruction: source.instruction,
        input: source.input,
        output: output.trim(),
        source: 'synthetic',
        qualityScore: 0,
        wordCount: countWords(output),
        createdAt: Date.now(),
      });
    } catch {
      // Skip failed generations silently
    }
  }
  return scoreDatasetEntries(results);
}

// ---------------------------------------------------------------------------
// Quality report
// ---------------------------------------------------------------------------

export function estimateDatasetQuality(entries: DatasetEntry[]): DatasetQualityReport {
  const accepted = entries.filter((e) => e.qualityScore >= QUALITY_ACCEPT_THRESHOLD);
  const flagged = entries.filter(
    (e) => e.qualityScore >= QUALITY_ACCEPT_THRESHOLD && e.qualityScore < QUALITY_FLAG_THRESHOLD,
  );
  const rejected = entries.filter((e) => e.qualityScore < QUALITY_ACCEPT_THRESHOLD);
  const avgScore =
    entries.length > 0 ? entries.reduce((s, e) => s + e.qualityScore, 0) / entries.length : 0;
  const avgWords =
    entries.length > 0 ? entries.reduce((s, e) => s + e.wordCount, 0) / entries.length : 0;
  return {
    totalEntries: entries.length,
    acceptedEntries: accepted.length,
    rejectedEntries: rejected.length,
    flaggedEntries: flagged.length,
    averageQualityScore: avgScore,
    averageWordCount: avgWords,
    sourceBreakdown: {
      extracted: entries.filter((e) => e.source === 'extracted').length,
      synthetic: entries.filter((e) => e.source === 'synthetic').length,
    },
    readyToTrain: accepted.length >= 50,
  };
}

// ---------------------------------------------------------------------------
// JSONL export
// ---------------------------------------------------------------------------

export function exportAsJsonl(entries: DatasetEntry[], format: DatasetFormat): string {
  const accepted = entries.filter((e) => e.qualityScore >= QUALITY_ACCEPT_THRESHOLD);
  return accepted
    .map((e) => {
      if (format === 'alpaca') {
        return JSON.stringify({
          instruction: e.instruction,
          input: e.input,
          output: e.output,
        });
      }
      if (format === 'chatml') {
        return JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a creative writing assistant.' },
            { role: 'user', content: e.instruction + (e.input ? `\n\n${e.input}` : '') },
            { role: 'assistant', content: e.output },
          ],
        });
      }
      // sharegpt
      return JSON.stringify({
        conversations: [
          { from: 'human', value: e.instruction + (e.input ? `\n\n${e.input}` : '') },
          { from: 'gpt', value: e.output },
        ],
      });
    })
    .join('\n');
}
