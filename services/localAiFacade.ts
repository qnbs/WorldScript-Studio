import {
  detectWebGpuSupport,
  type LocalAiResponse,
  runLocalTextGeneration,
  surrenderLeadership,
  type WebLlmProgressReport,
  WorkerBus,
} from '@domain/ai-core';
import { gpuResourceManager } from './ai/gpuResourceManager';
import { logger } from './logger';

const localWorkerBus = new WorkerBus();

export async function generateLocalText(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  loraAdapterId?: string,
  signal?: AbortSignal,
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

  // QNBS-v3: Acquire GPU mutex before WebLLM/ONNX-WebGPU init to prevent VRAM races across
  //          concurrent callers (e.g. ProForge agents running multiple pipeline stages).
  const needsGpu = detectWebGpuSupport();
  if (needsGpu) await gpuResourceManager.acquireGpu('webllm', 'high');

  const startedAt = performance.now();
  try {
    const result = await runLocalTextGeneration(prompt, modelId, onProgress, signal);
    localWorkerBus.recordResult(performance.now() - startedAt, true);
    return result;
  } catch (err) {
    // QNBS-v3: Log the actual error so telemetry and bug reports are useful.
    logger.warn('Local text generation failed:', err);
    localWorkerBus.recordResult(performance.now() - startedAt, false);
    return { layer: 'heuristic', text: 'Heuristic fallback response' };
  } finally {
    // QNBS-v3: Always release — gpuResourceManager has a 30s auto-release safety net too.
    if (needsGpu) gpuResourceManager.releaseGpu('webllm');
    // QNBS-v3: Surrender tab leader heartbeat so next inference cycle elects fairly.
    surrenderLeadership();
  }
}

export function getLocalWorkerBusTelemetry() {
  return localWorkerBus.getTelemetry();
}
