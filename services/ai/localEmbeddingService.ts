// QNBS-v3: Semantic embedding service — routes to inference.worker.ts via WorkerBus channels.
//          Uses Xenova/all-MiniLM-L6-v2 (384-dim, L2-normalized) for semantic RAG and cross-project search.
//          Adapted from CannaGuide-2025 embeddingService.ts patterns.

// QNBS-v3: logger import was missing — restartWorker() references logger.error on restart-limit.
import { logger } from '../logger';

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

// QNBS-v3: The inference worker is loaded lazily to avoid a 2 MB bundle on app start.
let workerInstance: Worker | null = null;
// QNBS-v3: Health check — 30s ping interval; worker restarts if no pong within PONG_TIMEOUT_MS.
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 5_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

// QNBS-v3: Exponential backoff for worker restart to prevent infinite spin on permanent failure.
let restartAttemptCount = 0;
const MAX_RESTART_ATTEMPTS = 5;
const MAX_RESTART_BACKOFF_MS = 60_000;

function getRestartBackoffMs(): number {
  return Math.min(2 ** restartAttemptCount * 1000, MAX_RESTART_BACKOFF_MS);
}

function clearWorkerHealthTimers(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (pongTimeoutTimer) {
    clearTimeout(pongTimeoutTimer);
    pongTimeoutTimer = null;
  }
}

function restartWorker(): void {
  clearWorkerHealthTimers();
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  if (import.meta.env?.DEV) {
    console.warn('[localEmbeddingService] Inference worker restarted (missed health check pong)');
  }
  restartAttemptCount++;
  if (restartAttemptCount > MAX_RESTART_ATTEMPTS) {
    logger.error(
      `[localEmbeddingService] Worker restart limit (${MAX_RESTART_ATTEMPTS}) reached. ` +
        'Embedding service is offline. Reload the app to retry.',
    );
    return;
  }
  const backoff = getRestartBackoffMs();
  if (backoff > 0) {
    setTimeout(() => startWorkerHealthCheck(), backoff);
  } else {
    startWorkerHealthCheck();
  }
}

function startWorkerHealthCheck(): void {
  if (typeof Worker === 'undefined') return;
  pingTimer = setInterval(() => {
    const w = workerInstance;
    if (!w) return;
    w.postMessage({ type: 'WORKER_PING' });
    pongTimeoutTimer = setTimeout(() => {
      // QNBS-v3: No pong received — worker is dead or hung; restart with backoff.
      restartWorker();
    }, PONG_TIMEOUT_MS);

    const pongHandler = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === 'WORKER_PONG') {
        // QNBS-v3: Successful pong resets the restart counter.
        restartAttemptCount = 0;
        if (pongTimeoutTimer) {
          clearTimeout(pongTimeoutTimer);
          pongTimeoutTimer = null;
        }
        w.removeEventListener('message', pongHandler);
      }
    };
    w.addEventListener('message', pongHandler);
  }, PING_INTERVAL_MS);
}

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../../workers/inference.worker.ts', import.meta.url), {
      type: 'module',
    });
    startWorkerHealthCheck();
  }
  return workerInstance;
}

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

function postToWorker(
  task: string,
  modelId: string,
  input: string,
): Promise<{ ok: boolean; result?: number[]; error?: string }> {
  return new Promise((resolve) => {
    const messageId = `emb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const worker = getWorker();

    const handler = (event: MessageEvent) => {
      const data = event.data as {
        messageId: string;
        ok: boolean;
        result?: number[];
        error?: string;
      };
      if (data.messageId !== messageId) return;
      worker.removeEventListener('message', handler);
      resolve(data);
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ messageId, task, modelId, input });
  });
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

  const response = await postToWorker('feature-extraction', EMBEDDING_MODEL, truncated);
  if (!response.ok || !response.result) {
    throw new Error(response.error ?? 'embedding failed');
  }
  const vector = l2Normalize(response.result);

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

// QNBS-v3: Used in testing to reset the worker instance without affecting production code.
export function _resetWorkerForTest(): void {
  clearWorkerHealthTimers();
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
