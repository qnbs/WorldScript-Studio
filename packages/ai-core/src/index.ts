import { electSingleHeavyInferenceTab } from './tabLeaderElection';

export type WorkerPriority = 'critical' | 'high' | 'normal' | 'low';

export type LocalAiLayer = 'webllm' | 'transformers' | 'heuristic';

export interface WorkerTask<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  priority: WorkerPriority;
  transferables?: Transferable[];
  createdAt: number;
}

export interface WorkerBusTelemetry {
  queueDepth: Record<WorkerPriority, number>;
  processedTasks: number;
  failedTasks: number;
  avgExecutionMs: number;
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

  enqueue(task: WorkerTask): void {
    this.queues[task.priority].push(task);
  }

  dequeue(): WorkerTask | undefined {
    for (const priority of PRIORITY_ORDER) {
      const next = this.queues[priority].shift();
      if (next !== undefined) return next;
    }
    return undefined;
  }

  recordResult(durationMs: number, isSuccess: boolean): void {
    this.processedTasks += 1;
    if (!isSuccess) this.failedTasks += 1;
    this.totalExecutionMs += durationMs;
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
    };
  }
}

export { electSingleHeavyInferenceTab };

// QNBS-v3: curated list of MLC-packaged checkpoints small enough for browser RAM; expand as new quants ship
export const WEBLLM_SUPPORTED_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (fast, ~0.7 GB)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (~1.8 GB)' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 Mini (~2.2 GB)' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B (~1.4 GB)' },
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

export async function runLocalTextGeneration(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
): Promise<LocalAiResponse> {
  const sanitizedPrompt = sanitizeForPrompt(prompt);
  if (!sanitizedPrompt.trim()) {
    return { layer: 'heuristic', text: 'Heuristic fallback response' };
  }

  const hasWebGpu = detectWebGpuSupport();
  const gpuTabLeader = hasWebGpu ? await electSingleHeavyInferenceTab() : true;
  // QNBS-v3: fall back to first supported model when caller omits modelId (keeps backward compat)
  const resolvedModelId = modelId ?? WEBLLM_SUPPORTED_MODELS[0].id;

  try {
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
    const m = mod as EngineModule;
    const CreateMLCEngine = m.CreateMLCEngine;
    // QNBS-v3: Nur ein Tab lädt WebLLM — vermeidet GPU/RAM-Kollision bei mehreren StoryCraft-Tabs.
    if (typeof CreateMLCEngine === 'function' && hasWebGpu && gpuTabLeader) {
      const engine = await CreateMLCEngine(resolvedModelId, {
        initProgressCallback: (p: unknown) => {
          if (onProgress && typeof p === 'object' && p !== null) {
            const r = p as { progress?: number; text?: string };
            onProgress({ progress: r.progress ?? 0, text: r.text ?? '' });
          }
        },
      });
      const reply = await engine.chat.completions.create({
        messages: [{ role: 'user', content: sanitizedPrompt }],
      });
      const text = reply.choices[0]?.message?.content?.trim();
      if (text) {
        return { layer: 'webllm', text };
      }
    }
  } catch {
    /* optional @mlc-ai/web-llm not installed, WebGPU, or model fetch blocked */
  }

  if (hasWebGpu) {
    if (!gpuTabLeader) {
      return {
        layer: 'webllm',
        text:
          'WebLLM: Another StoryCraft tab holds the local inference lock. Close extra tabs or use Ollama. Preview: ' +
          sanitizedPrompt.slice(0, 160) +
          (sanitizedPrompt.length > 160 ? '…' : ''),
      };
    }
    return {
      layer: 'webllm',
      text:
        'WebLLM: optional @mlc-ai/web-llm package or model weights unavailable in this environment. Use Ollama or Gemini. Sanitized prompt preview: ' +
        sanitizedPrompt.slice(0, 200) +
        (sanitizedPrompt.length > 200 ? '…' : ''),
    };
  }

  try {
    const { pipeline } = await import('@xenova/transformers');
    if (typeof pipeline === 'function') {
      return {
        layer: 'transformers',
        text:
          'Transformers.js pipeline available but no lightweight default model is forced in-app; use WebLLM or Ollama for full local inference. Echo: ' +
          sanitizedPrompt.slice(0, 160) +
          '…',
      };
    }
  } catch {
    /* optional */
  }

  return {
    layer: 'transformers',
    text: `Transformers placeholder response: ${sanitizedPrompt.slice(0, 280)}${sanitizedPrompt.length > 280 ? '…' : ''}`,
  };
}
