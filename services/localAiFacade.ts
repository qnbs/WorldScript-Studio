import {
  detectWebGpuSupport,
  type LocalAiResponse,
  runLocalTextGeneration,
  surrenderLeadership,
  type WebLlmProgressReport,
  WorkerBus,
} from '@domain/ai-core';
import { adaptiveAiEngine } from './ai/adaptiveAiEngine';
import { gpuResourceManager } from './ai/gpuResourceManager';
// QNBS-v3: C2 — lazy-import telemetry to avoid blocking cold start
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
    // QNBS-v3: When adaptive AI engine is enabled, use its task config for optimal backend/model.
    const adaptiveEnabled =
      typeof window !== 'undefined' && window.__storycraft_adaptive_ai__ === true;

    let result: LocalAiResponse;
    let usedBackend = 'heuristic';
    let usedModel = modelId ?? 'unknown';

    if (adaptiveEnabled) {
      const config = await adaptiveAiEngine.getTaskConfig('text-gen-short');
      usedBackend = config.backend;
      usedModel = config.modelId;
      result = await runLocalTextGeneration(prompt, config.modelId, onProgress, signal);
      adaptiveAiEngine.recordTaskLatency(
        'text-gen-short',
        config.backend,
        config.modelId,
        performance.now() - startedAt,
      );
    } else {
      result = await runLocalTextGeneration(prompt, modelId, onProgress, signal);
      usedBackend = result.layer;
    }

    const elapsedMs = performance.now() - startedAt;
    localWorkerBus.recordResult(elapsedMs, true);

    // QNBS-v3: C2 — record telemetry asynchronously (non-blocking, fire-and-forget)
    import('./ai/telemetryService')
      .then(({ recordInferenceTelemetry }) => {
        void recordInferenceTelemetry({
          taskType: 'text-gen-short',
          backend: usedBackend,
          modelId: usedModel,
          latencyMs: Math.round(elapsedMs),
          success: true,
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        /* telemetry is best-effort */
      });
    return result;
  } catch (err) {
    // QNBS-v3: Log the actual error so telemetry and bug reports are useful.
    logger.warn('Local text generation failed:', err);
    localWorkerBus.recordResult(performance.now() - startedAt, false);

    // QNBS-v3: C2 — record failure telemetry
    import('./ai/telemetryService')
      .then(({ recordInferenceTelemetry }) => {
        void recordInferenceTelemetry({
          taskType: 'text-gen-short',
          backend: 'heuristic',
          modelId: modelId ?? 'unknown',
          latencyMs: Math.round(performance.now() - startedAt),
          success: false,
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        /* telemetry is best-effort */
      });

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
