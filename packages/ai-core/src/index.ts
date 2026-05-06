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

export function detectWebGpuSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function sanitizeForPrompt(input: string): string {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phonePattern = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/g;
  const ibanPattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi;

  return input
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(phonePattern, '[REDACTED_PHONE]')
    .replace(ibanPattern, '[REDACTED_IBAN]');
}

export async function runLocalTextGeneration(prompt: string): Promise<LocalAiResponse> {
  const sanitizedPrompt = sanitizeForPrompt(prompt);
  if (detectWebGpuSupport()) {
    return { layer: 'webllm', text: `WebLLM placeholder response: ${sanitizedPrompt}` };
  }

  // Standard layer placeholder for CPU-compatible model execution.
  if (sanitizedPrompt.trim().length > 0) {
    return { layer: 'transformers', text: `Transformers placeholder response: ${sanitizedPrompt}` };
  }

  return { layer: 'heuristic', text: 'Heuristic fallback response' };
}
