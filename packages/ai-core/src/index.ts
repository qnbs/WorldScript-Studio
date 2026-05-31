import { electSingleHeavyInferenceTab, surrenderLeadership } from './tabLeaderElection';

export type WorkerPriority = 'critical' | 'high' | 'normal' | 'low';

// QNBS-v3: 'onnx' added as Layer-2 between WebLLM and Transformers.js (WASM fallback when no GPU).
export type LocalAiLayer = 'webllm' | 'onnx' | 'transformers' | 'heuristic';

// QNBS-v3: requeueCount tracks preemption history; auto-promote to 'normal' after MAX_PREEMPTIONS.
export interface WorkerTask<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  priority: WorkerPriority;
  transferables?: Transferable[];
  createdAt: number;
  requeueCount?: number;
}

export interface WorkerBusTelemetry {
  queueDepth: Record<WorkerPriority, number>;
  processedTasks: number;
  failedTasks: number;
  avgExecutionMs: number;
  // QNBS-v3: W-03 extended telemetry — peak latency, error rate, last success timestamp
  peakLatencyMs: number;
  errorRate: number;
  lastSuccessAt: number | null;
}

export interface LocalAiResponse {
  layer: LocalAiLayer;
  text: string;
}

export const SUPPORTED_WORKER_CHANNELS = [
  'local.text.generate',
  'local.text.stream',
  'local.embeddings.create',
  'local.rag.search',
  'local.rag.rank',
  'local.prompt.sanitize',
  'local.vision.caption',
  'local.vision.ocr',
  'local.heuristic.rewrite',
  'local.heuristic.summarize',
  'local.telemetry.flush',
] as const;

const PRIORITY_ORDER: readonly WorkerPriority[] = ['critical', 'high', 'normal', 'low'];

// QNBS-v3: tasks beyond this threshold are rejected (non-critical) to prevent OOM under load.
const MAX_QUEUE_SIZE = 32;
// QNBS-v3: low-priority tasks are auto-promoted after this many preemptions to prevent starvation.
const MAX_PREEMPTIONS = 3;

export class WorkerBus {
  private readonly queues: Record<WorkerPriority, WorkerTask[]> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  };

  private processedTasks = 0;
  private failedTasks = 0;
  private totalExecutionMs = 0;
  // QNBS-v3: W-03 extended telemetry fields
  private peakLatencyMs = 0;
  private lastSuccessAt: number | null = null;
  // QNBS-v3: per-task AbortControllers for in-flight cancellation
  private readonly taskAbortControllers = new Map<string, AbortController>();

  private totalQueueDepth(): number {
    return PRIORITY_ORDER.reduce((sum, p) => sum + this.queues[p].length, 0);
  }

  // QNBS-v3: W-01 backpressure — critical tasks always bypass; others are blocked when queue is full.
  isBackpressured(priority: WorkerPriority): boolean {
    if (priority === 'critical') return false;
    return this.totalQueueDepth() >= MAX_QUEUE_SIZE;
  }

  enqueue(task: WorkerTask): boolean {
    if (this.isBackpressured(task.priority)) return false;
    // QNBS-v3: W-02 preemption — low tasks re-queued > MAX_PREEMPTIONS times get promoted to 'normal'.
    const requeued = task.requeueCount ?? 0;
    const effectivePriority: WorkerPriority =
      task.priority === 'low' && requeued >= MAX_PREEMPTIONS ? 'normal' : task.priority;
    this.queues[effectivePriority].push({ ...task, priority: effectivePriority });
    return true;
  }

  dequeue(): WorkerTask | undefined {
    for (const priority of PRIORITY_ORDER) {
      const next = this.queues[priority].shift();
      if (next !== undefined) return next;
    }
    return undefined;
  }

  // QNBS-v3: Register an AbortController for a dequeued in-flight task; caller checks signal.aborted.
  registerTask(taskId: string): AbortSignal {
    const controller = new AbortController();
    this.taskAbortControllers.set(taskId, controller);
    return controller.signal;
  }

  // QNBS-v3: Cancel a queued task (removes from queue) or an in-flight task (signals AbortController).
  cancel(taskId: string): boolean {
    for (const priority of PRIORITY_ORDER) {
      const idx = this.queues[priority].findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        this.queues[priority].splice(idx, 1);
        this.taskAbortControllers.delete(taskId);
        return true;
      }
    }
    const controller = this.taskAbortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.taskAbortControllers.delete(taskId);
      return true;
    }
    return false;
  }

  recordResult(durationMs: number, isSuccess: boolean, taskId?: string): void {
    this.processedTasks += 1;
    if (!isSuccess) this.failedTasks += 1;
    else this.lastSuccessAt = Date.now();
    this.totalExecutionMs += durationMs;
    if (durationMs > this.peakLatencyMs) this.peakLatencyMs = durationMs;
    // QNBS-v3: clean up controller for completed/failed in-flight task
    if (taskId !== undefined) this.taskAbortControllers.delete(taskId);
  }

  getTelemetry(): WorkerBusTelemetry {
    return {
      queueDepth: {
        critical: this.queues.critical.length,
        high: this.queues.high.length,
        normal: this.queues.normal.length,
        low: this.queues.low.length,
      },
      processedTasks: this.processedTasks,
      failedTasks: this.failedTasks,
      avgExecutionMs:
        this.processedTasks === 0 ? 0 : Math.round(this.totalExecutionMs / this.processedTasks),
      peakLatencyMs: this.peakLatencyMs,
      errorRate: this.processedTasks === 0 ? 0 : this.failedTasks / this.processedTasks,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
}

export { electSingleHeavyInferenceTab, surrenderLeadership };

// QNBS-v3: curated list of ONNX models for WASM backend; no GPU required, ~50-500 MB WASM footprint.
//          Updated 2025: SmolLM2-135M is the best tiny ONNX text-gen model for inference.
export const ONNX_SUPPORTED_MODELS = [
  {
    id: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    label: 'SmolLM2 135M Instruct (~270 MB WASM)',
    requiresGpu: false,
  },
  { id: 'Xenova/distilgpt2', label: 'DistilGPT-2 (~82 MB WASM, legacy)', requiresGpu: false },
  { id: 'Xenova/gpt2', label: 'GPT-2 (~548 MB WASM, legacy)', requiresGpu: false },
] as const;

export type OnnxModelId = (typeof ONNX_SUPPORTED_MODELS)[number]['id'];

// QNBS-v3: curated MLC checkpoints; updated 2025 to include Llama 3.3, Phi-4, Gemma 3 releases.
export const WEBLLM_SUPPORTED_MODELS = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 0.5B (eco, ~0.4 GB)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (fast, ~0.7 GB)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (~1.8 GB)' },
  { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi-4 Mini 3.8B (~2.3 GB)' },
  { id: 'gemma-3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B (~0.8 GB)' },
  { id: 'gemma-3-4b-it-q4f32_1-MLC', label: 'Gemma 3 4B (~4.9 GB)' },
  { id: 'Llama-3.3-70B-Instruct-q3f16_1-MLC', label: 'Llama 3.3 70B (high-end, ~35 GB)' },
] as const;

export type WebLlmModelId = (typeof WEBLLM_SUPPORTED_MODELS)[number]['id'];

export interface WebLlmProgressReport {
  progress: number; // 0–1
  text: string;
}

export function detectWebGpuSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function sanitizeForPrompt(input: string): string {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phonePattern = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/g;
  const ibanPattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi;
  const jailbreakHints =
    /\b(ignore (all |previous |prior )?instructions|disregard (the )?(above|prior)|you are now (a |an )?(DAN|developer)|\[INST\]|<\|im_start\|>)\b/gi;

  let out = input
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(phonePattern, '[REDACTED_PHONE]')
    .replace(ibanPattern, '[REDACTED_IBAN]')
    .replace(jailbreakHints, '[filtered]');

  if (out.length > 12_000) {
    out = `${out.slice(0, 12_000)}\n…[truncated]`;
  }
  return out;
}

// QNBS-v3: 'Aborted' is the sentinel thrown across layers; callers rethrow it to short-circuit.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Aborted';
}

function warnAiCore(message: string, err: unknown): void {
  if (typeof console !== 'undefined' && 'warn' in console) {
    console.warn(`[ai-core] ${message}`, err);
  }
}

// QNBS-v3: Layer-1 WebLLM (WebGPU). Returns generated text, or null when WebLLM can't/shouldn't run
//          (no GPU, not tab leader, package absent, or empty completion). Throws 'Aborted' on signal.
//          Extracted from runLocalTextGeneration to keep that orchestrator under the complexity budget.
async function runWebLlmLayer(
  sanitizedPrompt: string,
  resolvedModelId: string,
  hasWebGpu: boolean,
  gpuTabLeader: boolean,
  onProgress?: (report: WebLlmProgressReport) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw new Error('Aborted');
  // QNBS-v3: Only one tab loads WebLLM — avoids GPU/RAM collision across multiple StoryCraft tabs.
  if (!hasWebGpu || !gpuTabLeader) return null;
  const mod = await import('@mlc-ai/web-llm');
  type EngineModule = typeof mod & {
    CreateMLCEngine?: (
      model: string,
      init?: { initProgressCallback?: (p: unknown) => void },
    ) => Promise<{
      chat: {
        completions: {
          create: (req: {
            messages: { role: string; content: string }[];
          }) => Promise<{ choices: { message?: { content?: string } }[] }>;
        };
      };
    }>;
  };
  const CreateMLCEngine = (mod as EngineModule).CreateMLCEngine;
  if (typeof CreateMLCEngine !== 'function') return null;
  const engine = await CreateMLCEngine(resolvedModelId, {
    initProgressCallback: (p: unknown) => {
      if (signal?.aborted) return;
      if (onProgress && typeof p === 'object' && p !== null) {
        const r = p as { progress?: number; text?: string };
        onProgress({ progress: r.progress ?? 0, text: r.text ?? '' });
      }
    },
  });
  if (signal?.aborted) throw new Error('Aborted');
  const reply = await engine.chat.completions.create({
    messages: [{ role: 'user', content: sanitizedPrompt }],
  });
  return reply.choices[0]?.message?.content?.trim() || null;
}

// QNBS-v3: Shared ONNX (Layer-2) + Transformers.js (Layer-3) text-generation path via
//          @huggingface/transformers. Returns generated text (echoed prompt stripped), or null when
//          the pipeline is unavailable/empty. Throws 'Aborted' on signal.
async function runTransformersLayer(
  sanitizedPrompt: string,
  model: string,
  maxNewTokens: number,
  temperature: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw new Error('Aborted');
  const { pipeline, env } = await import('@huggingface/transformers');
  if (typeof pipeline !== 'function') return null;
  interface XenovaEnv {
    backends?: { onnx?: { wasm?: { proxy?: boolean } } };
  }
  const typedEnv = env as unknown as XenovaEnv;
  if (typedEnv.backends?.onnx?.wasm) {
    typedEnv.backends.onnx.wasm.proxy = false;
  }
  const generator = await pipeline('text-generation', model, { dtype: 'q8' });
  if (signal?.aborted) throw new Error('Aborted');
  const result = (await generator(sanitizedPrompt, {
    max_new_tokens: maxNewTokens,
    temperature,
    do_sample: true,
  })) as Array<{ generated_text: string }>;
  const generated = result[0]?.generated_text?.trim() ?? '';
  // QNBS-v3: strip the echoed prompt that causal LMs prepend to their completion.
  const text = generated.startsWith(sanitizedPrompt)
    ? generated.slice(sanitizedPrompt.length).trim()
    : generated;
  return text || null;
}

/**
 * Multi-layer local text generation: WebLLM (WebGPU) → ONNX WASM → Transformers.js → heuristic.
 * Each layer logs and falls through on failure; an aborted signal short-circuits with 'Aborted'.
 */
export async function runLocalTextGeneration(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  signal?: AbortSignal,
): Promise<LocalAiResponse> {
  const sanitizedPrompt = sanitizeForPrompt(prompt);
  if (!sanitizedPrompt.trim()) {
    return { layer: 'heuristic', text: 'Heuristic fallback response' };
  }

  const hasWebGpu = detectWebGpuSupport();
  const gpuTabLeader = hasWebGpu ? await electSingleHeavyInferenceTab() : true;
  // QNBS-v3: fall back to first supported model when caller omits modelId (keeps backward compat)
  const resolvedModelId = modelId ?? WEBLLM_SUPPORTED_MODELS[0].id;

  // Layer-1: WebLLM (WebGPU, highest quality)
  try {
    const text = await runWebLlmLayer(
      sanitizedPrompt,
      resolvedModelId,
      hasWebGpu,
      gpuTabLeader,
      onProgress,
      signal,
    );
    if (text) return { layer: 'webllm', text };
  } catch (err) {
    if (isAbortError(err)) throw err;
    warnAiCore('WebLLM layer failed:', err);
  }

  // QNBS-v3: another tab owns the GPU lock — surface an actionable message, not a silent downgrade.
  if (hasWebGpu && !gpuTabLeader) {
    return {
      layer: 'webllm',
      text:
        'WebLLM: Another StoryCraft tab holds the local inference lock. Close extra tabs or use Ollama. Preview: ' +
        sanitizedPrompt.slice(0, 160) +
        (sanitizedPrompt.length > 160 ? '…' : ''),
    };
  }

  // Layer-2: ONNX WASM (no GPU required)
  try {
    const text = await runTransformersLayer(
      sanitizedPrompt,
      ONNX_SUPPORTED_MODELS[0].id,
      128,
      0.7,
      signal,
    );
    if (text) return { layer: 'onnx', text };
  } catch (err) {
    if (isAbortError(err)) throw err;
    warnAiCore('ONNX layer failed:', err);
  }

  // Layer-3: Transformers.js (distilgpt2)
  try {
    const text = await runTransformersLayer(sanitizedPrompt, 'Xenova/distilgpt2', 64, 0.8, signal);
    if (text) return { layer: 'transformers', text };
  } catch (err) {
    if (isAbortError(err)) throw err;
    warnAiCore('Transformers.js layer failed:', err);
  }

  // QNBS-v3: Layer-4 heuristic — all inference layers unavailable; echo sanitized prompt as fallback.
  return {
    layer: 'heuristic',
    text: `${sanitizedPrompt.slice(0, 280)}${sanitizedPrompt.length > 280 ? '…' : ''}`,
  };
}
