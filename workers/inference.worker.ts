/// <reference lib="webworker" />
// QNBS-v3: Off-main-thread inference worker for @huggingface/transformers v3 (ONNX backend).
//          Uses WorkerBus request/response protocol with messageId correlation.
//          Adapted from CannaGuide-2025 inference.worker.ts patterns for creative-writing tasks.

import { PipelineLruCache } from '../services/ai/pipelineLruCache';

export type WorkerTaskType =
  | 'text-generation'
  | 'feature-extraction'
  | 'sentiment-analysis'
  | 'summarization';

export interface InferenceRequest {
  messageId: string;
  task: WorkerTaskType;
  modelId: string;
  input: string;
  pipelineOptions?: { quantized?: boolean };
  inferenceOptions?: {
    max_new_tokens?: number;
    do_sample?: boolean;
    temperature?: number;
    return_full_text?: boolean;
  };
}

export interface InferenceResponse {
  messageId: string;
  ok: boolean;
  result?: string | number[];
  error?: string;
  latencyMs?: number;
}

// QNBS-v3: Phase 2.3 — shared LRU now disposes evicted pipelines (closes a VRAM leak) and dedups
//          concurrent same-model loads. `dispose()` is best-effort; absent on some backends.
const pipelineCache = new PipelineLruCache<unknown>({
  // QNBS-v3: return the (possibly async) dispose result; PipelineLruCache catches sync/async failure.
  dispose: (pipe) => (pipe as { dispose?: () => void | Promise<void> }).dispose?.(),
});

let transformersModule: { pipeline: (...args: unknown[]) => Promise<unknown> } | null = null;

// QNBS-v3: Lazy import — avoids loading the 2 MB transformers bundle until first inference request.
async function getTransformers() {
  if (!transformersModule) {
    // Dynamic import so the worker bundle is only loaded when actually needed.
    const mod = await import('@huggingface/transformers');
    transformersModule = mod as unknown as typeof transformersModule;
  }
  return transformersModule!;
}

// QNBS-v3: Security guard — only process messages from the same origin.
function isTrustedWorkerMessage(event: MessageEvent): boolean {
  // In a dedicated worker, event.origin is '' (empty string) for same-origin posts.
  // We reject messages with non-empty origins that don't match our scope.
  return event.origin === '' || event.origin === globalThis.location?.origin;
}

async function loadPipeline(task: WorkerTaskType, modelId: string, quantized = true) {
  const cacheKey = `${task}::${modelId}`;
  return pipelineCache.getOrLoad(cacheKey, async () => {
    const { pipeline } = await getTransformers();
    // QNBS-v3: Device auto-selection — webgpu if available, else wasm.
    const device =
      typeof globalThis.navigator !== 'undefined' && 'gpu' in globalThis.navigator
        ? 'webgpu'
        : 'wasm';
    // QNBS-v3: transformers.js v3 replaced `quantized: boolean` with `dtype`; q8 ≈ old quantized=true.
    return (pipeline as (task: string, model: string, opts: unknown) => Promise<unknown>)(
      task,
      modelId,
      { dtype: quantized ? 'q8' : 'fp32', device },
    );
  });
}

async function runInference(
  req: InferenceRequest,
  signal?: AbortSignal,
): Promise<InferenceResponse> {
  const start = Date.now();
  try {
    if (signal?.aborted) throw new Error('Aborted');
    const pipe = await loadPipeline(req.task, req.modelId, req.pipelineOptions?.quantized ?? true);
    if (signal?.aborted) throw new Error('Aborted');

    const opts = req.inferenceOptions ?? {};
    let rawResult: unknown;

    if (req.task === 'feature-extraction') {
      rawResult = await (pipe as (input: string, opts: unknown) => Promise<unknown>)(req.input, {
        pooling: 'mean',
        normalize: true,
        ...opts,
      });
    } else {
      rawResult = await (pipe as (input: string, opts: unknown) => Promise<unknown>)(
        req.input,
        opts,
      );
    }

    // Normalise result to string or number[]
    let result: string | number[];
    if (req.task === 'feature-extraction') {
      // Flatten Float32Array / nested array to plain number[]
      const flat = rawResult as { data?: Float32Array } | Float32Array | number[];
      if (flat instanceof Float32Array) {
        result = Array.from(flat);
      } else if (
        'data' in (flat as object) &&
        (flat as { data: Float32Array }).data instanceof Float32Array
      ) {
        result = Array.from((flat as { data: Float32Array }).data);
      } else {
        result = Array.from(flat as Iterable<number>);
      }
    } else {
      // text-generation, summarization, sentiment-analysis → extract text / label
      const arr = rawResult as Array<{
        generated_text?: string;
        summary_text?: string;
        label?: string;
        score?: number;
      }>;
      if (req.task === 'sentiment-analysis') {
        result = `${arr[0]?.label ?? 'NEUTRAL'}:${(arr[0]?.score ?? 0).toFixed(4)}`;
      } else {
        result = arr[0]?.generated_text ?? arr[0]?.summary_text ?? '';
      }
    }

    return { messageId: req.messageId, ok: true, result, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      messageId: req.messageId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

// QNBS-v3: In-flight AbortController map so callers can cancel long-running inference.
const abortMap = new Map<string, AbortController>();

self.addEventListener('message', (event: MessageEvent) => {
  if (!isTrustedWorkerMessage(event)) return;

  const data = event.data as { type?: string; messageId?: string } & InferenceRequest;

  // QNBS-v3: Health check ping — reply with pong so the host can detect worker liveness.
  if (data.type === 'WORKER_PING') {
    self.postMessage({ type: 'WORKER_PONG', ts: Date.now() });
    return;
  }

  if (data.type === 'WORKER_CANCEL' && data.messageId) {
    abortMap.get(data.messageId)?.abort();
    abortMap.delete(data.messageId);
    return;
  }

  const controller = new AbortController();
  abortMap.set(data.messageId, controller);

  void runInference(data, controller.signal).then((response) => {
    abortMap.delete(data.messageId);
    self.postMessage(response);
  });
});
