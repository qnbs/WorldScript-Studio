import {
  type LocalAiResponse,
  runLocalTextGeneration,
  type WebLlmProgressReport,
  WorkerBus,
} from '@domain/ai-core';
import { logger } from './logger';

const localWorkerBus = new WorkerBus();

export async function generateLocalText(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  loraAdapterId?: string,
): Promise<LocalAiResponse> {
  const taskId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `local-ai-${Date.now()}`;

  // QNBS-v3: Check backpressure before enqueue — returns false when queue ≥ MAX_QUEUE_SIZE.
  const enqueued = localWorkerBus.enqueue({
    id: taskId,
    type: 'local.text.generate',
    // QNBS-v3: loraAdapterId is wired through the task payload for future worker-side LoRA loading.
    payload: { prompt, modelId, loraAdapterId },
    priority: 'normal',
    createdAt: Date.now(),
  });
  if (!enqueued) {
    logger.warn('WorkerBus backpressure: local AI task rejected (queue full)');
    return { layer: 'heuristic', text: 'AI system busy — please try again in a moment.' };
  }

  const task = localWorkerBus.dequeue();
  if (!task) {
    return { layer: 'heuristic', text: 'No local task available.' };
  }

  const startedAt = performance.now();
  try {
    const result = await runLocalTextGeneration(prompt, modelId, onProgress);
    localWorkerBus.recordResult(performance.now() - startedAt, true);
    return result;
  } catch {
    localWorkerBus.recordResult(performance.now() - startedAt, false);
    return { layer: 'heuristic', text: 'Heuristic fallback response' };
  }
}

export function getLocalWorkerBusTelemetry() {
  return localWorkerBus.getTelemetry();
}
