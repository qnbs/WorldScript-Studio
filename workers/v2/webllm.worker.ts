/// <reference lib="webworker" />
// QNBS-v3: P1-1 — WorkerBus v2 WebLLM worker. Runs heavy MLC (WebGPU) inference fully off the
//          main thread so model loading + token generation never block the UI. Mirrors the
//          inference.worker.ts pattern (lazy heavy import, abort via ctx.signal, progress emit).
//          A dedicated pool keeps @mlc-ai/web-llm out of the transformers.js worker bundle.

import type { WebLlmModelId } from '../../packages/ai-core/src/index';
// QNBS-v3: Import the optimizer directly (not the ai-core barrel) so the worker bundle pulls only
//          the WebLLM engine cache — @mlc-ai/web-llm itself stays a dynamic import inside it.
import { getWebLlmEngine } from '../../packages/ai-core/src/webllmOptimizer';
import {
  registerTaskHandler,
  type WorkerHandlerContext,
} from '../../packages/worker-bus/src/workerBootstrap';

export interface WebLlmTaskPayload {
  readonly prompt: string;
  readonly modelId: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  // QNBS-v3: wired through for future worker-side LoRA loading; unused by MLC today.
  readonly loraAdapterId?: string;
}

export interface WebLlmTaskResult {
  readonly text: string;
  readonly layer: 'webllm';
  readonly modelId: string;
}

/** QNBS-v3: 'NO_WEBGPU' is the sentinel the caller maps to its main-thread fallback path. */
function assertWebGpu(): void {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || !('gpu' in nav)) throw new Error('NO_WEBGPU');
}

/** QNBS-v3: WebLLM load progress is 0–1; clamp into the [0.05, 0.95] band reserved for loading. */
function clampLoadProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0.05;
  return Math.min(0.95, Math.max(0.05, progress));
}

export async function handleWebLlm(ctx: WorkerHandlerContext): Promise<WebLlmTaskResult> {
  const { payload, signal, emitProgress } = ctx;
  const req = payload as WebLlmTaskPayload;

  if (signal.aborted) throw new Error('Aborted');
  assertWebGpu();

  emitProgress('loading', 0.05, 'Loading model');
  const engine = await getWebLlmEngine(req.modelId as WebLlmModelId, {
    onProgress: (p) =>
      emitProgress('loading', clampLoadProgress(p.progress), p.text || 'Loading model'),
  });
  // QNBS-v3: null engine = package absent / CreateMLCEngine unavailable → let the caller fall back.
  if (!engine) throw new Error('WEBLLM_UNAVAILABLE');
  if (signal.aborted) throw new Error('Aborted');

  emitProgress('inference', 0.97, 'Generating');
  const reply = await engine.chat.completions.create({
    messages: [{ role: 'user', content: req.prompt }],
    max_tokens: req.maxTokens ?? 256,
    temperature: req.temperature ?? 0.7,
  });
  if (signal.aborted) throw new Error('Aborted');

  const text = reply.choices[0]?.message?.content?.trim() ?? '';
  emitProgress('done', 1, 'Complete');
  return { text, layer: 'webllm', modelId: req.modelId };
}

registerTaskHandler('inference.webllm', handleWebLlm, ['inference.webllm']);
