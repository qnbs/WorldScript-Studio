// QNBS-v3: Semantic embedding service — routes to inference.worker.ts via WorkerBus channels.
//          Uses Xenova/all-MiniLM-L6-v2 (384-dim, L2-normalized) for semantic RAG and cross-project search.
//          Adapted from CannaGuide-2025 embeddingService.ts patterns.

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const MAX_INPUT_CHARS = 512;
const MICRO_BATCH_SIZE = 8;

export type EmbeddingVector = Float32Array;

// QNBS-v3: The inference worker is loaded lazily to avoid a 2 MB bundle on app start.
let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../../workers/inference.worker.ts', import.meta.url), {
      type: 'module',
    });
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
  const response = await postToWorker('feature-extraction', EMBEDDING_MODEL, truncated);
  if (!response.ok || !response.result) {
    throw new Error(response.error ?? 'embedding failed');
  }
  return l2Normalize(response.result);
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
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
