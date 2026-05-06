import { type LocalAiResponse, runLocalTextGeneration, WorkerBus } from '@domain/ai-core';

const localWorkerBus = new WorkerBus();

export async function generateLocalText(prompt: string): Promise<LocalAiResponse> {
  const taskId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `local-ai-${Date.now()}`;

  localWorkerBus.enqueue({
    id: taskId,
    type: 'local.text.generate',
    payload: { prompt },
    priority: 'normal',
    createdAt: Date.now(),
  });

  const task = localWorkerBus.dequeue();
  if (!task) {
    return { layer: 'heuristic', text: 'No local task available.' };
  }

  const startedAt = performance.now();
  try {
    const result = await runLocalTextGeneration(prompt);
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
