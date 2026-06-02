// QNBS-v3: Phase 2 — LegacyWorkerBusAdapter shims the old @domain/ai-core WorkerBus API
//          onto the new @domain/worker-bus v2 engine. Allows old callers (priority-queue
//          enqueue/cancel/telemetry) to keep working while code migrates to TaskHandle.
//          Remove once all callers adopt the v2 bus directly.

import type { WorkerTask } from '@domain/ai-core';
import type { WorkerBus } from '@domain/worker-bus';

// QNBS-v3: Mirror of ai-core WorkerBusTelemetry — kept local to avoid cross-package type import.
interface LegacyTelemetry {
  readonly queueDepth: Record<'critical' | 'high' | 'normal' | 'low', number>;
  readonly processedTasks: number;
  readonly failedTasks: number;
  readonly avgExecutionMs: number;
  readonly peakLatencyMs: number;
  readonly errorRate: number;
  readonly lastSuccessAt: number | null;
}

export class LegacyWorkerBusAdapter {
  private readonly v2Bus: WorkerBus;
  private _processedTasks = 0;
  private _failedTasks = 0;
  private _totalExecutionMs = 0;
  private _peakLatencyMs = 0;
  private _lastSuccessAt: number | null = null;

  constructor(v2Bus: WorkerBus) {
    this.v2Bus = v2Bus;
  }

  /**
   * Enqueue an old-style WorkerTask on the v2 bus.
   * Returns false on backpressure (circuit open or queue full), true otherwise.
   * The task executes automatically via the worker pool — no `dequeue()` call needed.
   */
  enqueue(task: WorkerTask): boolean {
    try {
      const opts =
        task.transferables !== undefined
          ? { priority: task.priority, transferables: [...task.transferables] }
          : { priority: task.priority };
      const handle = this.v2Bus.enqueue(task.type, task.payload, opts);
      const startedAt = task.createdAt;
      void handle.result
        .then(() => this._recordResult(Date.now() - startedAt, true))
        .catch(() => this._recordResult(Date.now() - startedAt, false));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel a task by ID. Works for both queued and in-flight tasks.
   */
  cancel(taskId: string): boolean {
    return this.v2Bus.cancel(taskId);
  }

  /**
   * No-op in v2 — tasks auto-execute via worker pool; there is nothing to dequeue.
   * Returns undefined to match the old API surface.
   */
  dequeue(): undefined {
    return undefined;
  }

  /**
   * Register an in-flight task and return an AbortSignal for it.
   * In v2 the bus owns cancellation internally; this returns a standalone signal
   * that old callers may check, but it is not wired to the task.
   */
  registerTask(_taskId: string): AbortSignal {
    return new AbortController().signal;
  }

  /**
   * Returns telemetry in the old @domain/ai-core WorkerBusTelemetry shape,
   * blending v2 queue depths with adapter-tracked counters.
   */
  getTelemetry(): LegacyTelemetry {
    const v2 = this.v2Bus.getTelemetry();
    return {
      queueDepth: {
        critical: v2.queueDepth.critical,
        high: v2.queueDepth.high,
        normal: v2.queueDepth.normal,
        low: v2.queueDepth.low,
      },
      processedTasks: this._processedTasks,
      failedTasks: this._failedTasks,
      avgExecutionMs:
        this._processedTasks === 0 ? 0 : Math.round(this._totalExecutionMs / this._processedTasks),
      peakLatencyMs: this._peakLatencyMs,
      errorRate: this._processedTasks === 0 ? 0 : this._failedTasks / this._processedTasks,
      lastSuccessAt: this._lastSuccessAt,
    };
  }

  private _recordResult(durationMs: number, isSuccess: boolean): void {
    this._processedTasks += 1;
    if (!isSuccess) this._failedTasks += 1;
    else this._lastSuccessAt = Date.now();
    this._totalExecutionMs += durationMs;
    if (durationMs > this._peakLatencyMs) this._peakLatencyMs = durationMs;
  }
}
