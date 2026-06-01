/// <reference lib="webworker" />
// QNBS-v3: WorkerBus v2 inference worker. Wraps legacy inference.worker.ts logic
//          in the typed bootstrap protocol.

import {
  registerTaskHandler,
  type WorkerHandlerContext,
} from '../../packages/worker-bus/src/workerBootstrap';

// QNBS-v3: Lazy import transformers.js to keep worker spawn fast.
let transformersModule: { pipeline: (...args: unknown[]) => Promise<unknown> } | null = null;

async function getTransformers() {
  if (!transformersModule) {
    const mod = await import('@huggingface/transformers');
    transformersModule = mod as unknown as typeof transformersModule;
  }
  return transformersModule!;
}

const pipelineCache = new Map<string, { pipeline: unknown; lastUsedAt: number }>();
const MAX_PIPELINE_CACHE = 8;

async function loadPipeline(task: string, modelId: string, quantized = true) {
  const cacheKey = `${task}::${modelId}`;
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.pipeline;
  }

  if (pipelineCache.size >= MAX_PIPELINE_CACHE) {
    let oldestKey = '';
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of pipelineCache) {
      if (entry.lastUsedAt < oldestTs) {
        oldestTs = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) pipelineCache.delete(oldestKey);
  }

  const { pipeline } = await getTransformers();
  const device =
    typeof globalThis.navigator !== 'undefined' && 'gpu' in globalThis.navigator
      ? 'webgpu'
      : 'wasm';
  const pipe = await (pipeline as (task: string, model: string, opts: unknown) => Promise<unknown>)(
    task,
    modelId,
    { dtype: quantized ? 'q8' : 'fp32', device },
  );
  pipelineCache.set(cacheKey, { pipeline: pipe, lastUsedAt: Date.now() });
  return pipe;
}

async function handleInference(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload, signal, emitProgress } = ctx;
  const req = payload as {
    task: string;
    modelId: string;
    input: string;
    pipelineOptions?: { quantized?: boolean };
    inferenceOptions?: Record<string, unknown>;
  };

  if (signal.aborted) throw new Error('Aborted');
  emitProgress('loading', 0.2, 'Loading model');

  const pipe = await loadPipeline(req.task, req.modelId, req.pipelineOptions?.quantized ?? true);
  if (signal.aborted) throw new Error('Aborted');
  emitProgress('inference', 0.6, 'Running inference');

  const opts = req.inferenceOptions ?? {};
  let rawResult: unknown;

  if (req.task === 'feature-extraction') {
    rawResult = await (pipe as (input: string, opts: unknown) => Promise<unknown>)(req.input, {
      pooling: 'mean',
      normalize: true,
      ...opts,
    });
  } else {
    rawResult = await (pipe as (input: string, opts: unknown) => Promise<unknown>)(req.input, opts);
  }

  emitProgress('done', 1.0, 'Complete');

  if (req.task === 'feature-extraction') {
    const flat = rawResult as { data?: Float32Array } | Float32Array | number[];
    if (flat instanceof Float32Array) return Array.from(flat);
    if (
      'data' in (flat as object) &&
      (flat as { data: Float32Array }).data instanceof Float32Array
    ) {
      return Array.from((flat as { data: Float32Array }).data);
    }
    return Array.from(flat as Iterable<number>);
  }

  const arr = rawResult as Array<{
    generated_text?: string;
    summary_text?: string;
    label?: string;
    score?: number;
  }>;
  if (req.task === 'sentiment-analysis') {
    return `${arr[0]?.label ?? 'NEUTRAL'}:${(arr[0]?.score ?? 0).toFixed(4)}`;
  }
  return arr[0]?.generated_text ?? arr[0]?.summary_text ?? '';
}

registerTaskHandler('inference.text', handleInference, ['inference.text']);
registerTaskHandler('inference.embed', handleInference, ['inference.embed']);
