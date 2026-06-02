// QNBS-v3: Phase 2 — HybridRouter routes tasks to the appropriate backend:
//          • target:'rust' + enableRustCompute + Tauri context → Rust TaskSupervisor
//          • everything else (or Rust unavailable) → WorkerBus v2 Web Worker pool
//          Falls back to web silently on any Rust failure. Returns null only when
//          WorkerBus v2 is not initialized (flag off or startup race).

import type { EnqueueOptions, RustTaskRequest, TaskHandle, TaskProgress } from '@domain/worker-bus';
import { createLogger } from './logger';
import {
  invalidateRustAvailabilityCache,
  invokeRustTask,
  isRustComputeAvailable,
} from './tauriTaskBridge';
import { getWorkerBus } from './workerBusManager';

const log = createLogger('hybridRouter');

export interface HybridRouteOptions extends Omit<EnqueueOptions, 'target'> {
  /** Routing hint: 'rust' to prefer Tauri, 'any'/'web' to use web worker pool. Default: 'any'. */
  readonly target?: 'web' | 'rust' | 'any';
  /** Pass selectEnableRustCompute value here — keeps the router free of Redux coupling. */
  readonly rustComputeEnabled?: boolean;
}

// QNBS-v3: Empty async generator to satisfy AsyncIterable<TaskProgress> for Rust task handles.
async function* _emptyProgress(): AsyncGenerator<TaskProgress, void, unknown> {
  // intentionally empty — Rust TaskSupervisor Phase 2 does not stream progress
}

/**
 * Route a task to the Web Worker pool or Rust TaskSupervisor.
 *
 * Returns null when WorkerBus v2 is not initialized (flag off or still starting up).
 * Callers should gracefully skip or fall back to the legacy inference path.
 */
export async function routeTask<TResult = unknown>(
  taskType: string,
  payload: unknown,
  opts: HybridRouteOptions = {},
): Promise<TaskHandle<TResult> | null> {
  const { target = 'any', rustComputeEnabled = false, ...busOpts } = opts;

  // QNBS-v3: Rust path — only when explicitly targeted or 'any' with rust flag on
  if (rustComputeEnabled && (target === 'rust' || target === 'any')) {
    const rustAvailable = await isRustComputeAvailable();
    if (rustAvailable) {
      try {
        const request: RustTaskRequest = {
          taskId: crypto.randomUUID(),
          taskType,
          payload,
          priority: opts.priority ?? 'normal',
          target: 'rust',
          timeoutMs: opts.timeoutMs ?? 300_000,
        };
        const rustResult = await invokeRustTask(request);
        const rustHandle: TaskHandle<TResult> = {
          taskId: request.taskId,
          result: rustResult.success
            ? Promise.resolve(rustResult.payload as TResult)
            : Promise.reject(new Error(rustResult.error ?? 'Rust TaskSupervisor failed')),
          progress: _emptyProgress(),
          // QNBS-v3: Rust tasks are not cancellable in Phase 2 (Tauri invoke is synchronous)
          cancel: () => {
            log.warn('cancel() called on Rust task — not supported in Phase 2', {
              taskId: request.taskId,
            });
          },
        };
        log.info('Task routed to Rust TaskSupervisor', { taskType, taskId: request.taskId });
        return rustHandle;
      } catch (err) {
        log.warn('Rust route failed — falling back to web worker pool', { taskType, err });
        // Fall through to web worker path
      }
    }
  }

  // Web worker path (default and fallback)
  const bus = getWorkerBus();
  if (bus === null) {
    log.warn('WorkerBus v2 not initialized — task dropped', { taskType });
    return null;
  }

  return bus.enqueue<unknown, TResult>(taskType, payload, { ...busOpts, target: 'web' });
}

/**
 * Invalidate the Rust availability cache after flag toggle so the next routeTask()
 * call does a fresh ping rather than serving a stale cached result.
 */
export { invalidateRustAvailabilityCache };
