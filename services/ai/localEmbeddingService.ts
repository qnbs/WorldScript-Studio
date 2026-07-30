// QNBS-v3: [Semantic embedding service — routes to workers/v2/inference.worker.ts via WorkerBus v2 (docs/adr/0014 migration). Xenova/all-MiniLM-L6-v2, 384-dim, L2-normalized.]

import { ensureInferencePool } from '../workerBusManager';

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const MAX_INPUT_CHARS = 512;
const MICRO_BATCH_SIZE = 8;

// QNBS-v3: LRU cache — eliminates ~400ms re-embedding per RAG query on unchanged sections.
//          Map preserves insertion order; we evict the first (oldest) entry at capacity.
const EMBEDDING_CACHE_MAX = 1_000;
const embeddingCache = new Map<string, EmbeddingVector>();

/** Build a stable cache key from the model and truncated text. */
function makeCacheKey(text: string): string {
  // \x00 separator prevents model name from bleeding into text content
  return `${EMBEDDING_MODEL}\x00${text}`;
}

export type EmbeddingVector = Float32Array;

function truncate(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  // QNBS-v3: Silent truncation — warn in dev builds only.
  if (import.meta.env?.DEV) {
    console.warn(
      `[localEmbeddingService] Input truncated from ${text.length} to ${MAX_INPUT_CHARS} chars`,
    );
  }
  return text.slice(0, MAX_INPUT_CHARS);
}

// QNBS-v3: L2-normalise a float vector so cosine similarity = dot product.
function l2Normalize(vec: number[]): EmbeddingVector {
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (magnitude === 0) return new Float32Array(vec.length);
  return new Float32Array(vec.map((v) => v / magnitude));
}

async function requestEmbedding(task: string, modelId: string, input: string): Promise<number[]> {
  const bus = await ensureInferencePool();
  if (!bus) throw new Error('WorkerBus v2 unavailable');
  const handle = bus.enqueue<{ task: string; modelId: string; input: string }, number[]>(
    'inference.embed',
    { task, modelId, input },
    { capabilities: ['inference.embed'] },
  );
  return handle.result;
}

export async function embedText(text: string): Promise<EmbeddingVector> {
  const truncated = truncate(text);
  const cacheKey = makeCacheKey(truncated);

  // QNBS-v3: LRU hit — delete then re-insert to move to the end (most-recently-used).
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    embeddingCache.delete(cacheKey);
    embeddingCache.set(cacheKey, cached);
    return cached;
  }

  const raw = await requestEmbedding('feature-extraction', EMBEDDING_MODEL, truncated);
  const vector = l2Normalize(raw);

  // QNBS-v3: Evict the oldest (first) entry when at capacity before inserting.
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey !== undefined) embeddingCache.delete(firstKey);
  }
  embeddingCache.set(cacheKey, vector);

  return vector;
}

/** Clear the in-memory embedding cache (e.g. when model version changes). */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

// QNBS-v3: Micro-batch to avoid overwhelming the worker queue; batch size = MICRO_BATCH_SIZE.
export async function embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
  const results: EmbeddingVector[] = [];
  for (let i = 0; i < texts.length; i += MICRO_BATCH_SIZE) {
    const batch = texts.slice(i, i + MICRO_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((t) => embedText(t)));
    results.push(...batchResults);
  }
  return results;
}

export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  // Both vectors are already L2-normalised, so cosine = dot product
  return Math.max(-1, Math.min(1, dot));
}
