// QNBS-v3: WorkerBus v2 — central orchestrator. All background tasks flow through here.
//          Integrates queue, pool, circuit breaker, DLQ, cancellation, and telemetry.

import { createLogger } from '../../../services/logger';
import { type CancellationToken, createCancellationToken } from './cancellation';
import { CircuitBreaker } from './circuitBreaker';
import { DeadLetterQueue } from './deadLetterQueue';
import { createCancelMessage, createTaskMessage, validateWorkerMessage } from './messageBus';
import { ProgressEmitter } from './progressEmitter';
import { PriorityTaskQueue } from './taskQueue';
import type {
  BusEvent,
  BusEventListener,
  EnqueueOptions,
  TaskErrorInfo,
  TaskHandle,
  TaskResult,
  WorkerBusOptions,
  WorkerBusTelemetry,
  WorkerCapability,
  WorkerPoolOptions,
  WorkerTask,
} from './types';
import { WorkerPool } from './workerPool';

const log = createLogger('worker-bus');

export class WorkerBus {
  private readonly queue: PriorityTaskQueue;
  private readonly pools = new Map<string, WorkerPool>();
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly dlq: DeadLetterQueue;
  private readonly progress = new ProgressEmitter();
  private readonly tokens = new Map<string, CancellationToken>();
  private readonly listeners = new Set<BusEventListener>();
  private running = false;
  private pumpScheduled = false;
  private processedTasks = 0;
  private failedTasks = 0;
  private totalExecutionMs = 0;
  private totalQueueTimeMs = 0;
  private peakLatencyMs = 0;
  private lastSuccessAt: number | null = null;

  constructor(private readonly options: WorkerBusOptions) {
    this.queue = new PriorityTaskQueue(options.maxQueueSize);
    this.dlq = new DeadLetterQueue(options.deadLetterCapacity ?? 64);
    this.running = true;
    this.schedulePump();
  }

  registerPool(
    poolId: string,
    capabilities: readonly WorkerCapability[],
    opts: WorkerPoolOptions,
  ): void {
    if (this.pools.has(poolId)) {
      log.warn(`Pool ${poolId} already registered`);
      return;
    }
    this.pools.set(poolId, new WorkerPool(poolId, capabilities, opts));
  }

  enqueue<TPayload, TResult>(
    taskType: string,
    payload: TPayload,
    opts: EnqueueOptions = {},
  ): TaskHandle<TResult> {
    const taskId = crypto.randomUUID();
    const traceId = opts.parentTaskId ? `${opts.parentTaskId}:${taskId}` : taskId;
    const token = createCancellationToken();
    this.tokens.set(taskId, token);

    const task: WorkerTask<TPayload> = {
      taskId,
      taskType,
      payload,
      priority: opts.priority ?? 'normal',
      target: opts.target ?? 'any',
      capabilities: opts.capabilities ?? [],
      transferables: opts.transferables,
      createdAt: Date.now(),
      timeoutMs: opts.timeoutMs ?? 300_000,
      retryPolicy: {
        maxRetries: 2,
        backoffMs: 400,
        maxBackoffMs: 30_000,
        jitter: true,
        ...(opts.retryPolicy ?? {}),
      },
      traceId,
      parentTaskId: opts.parentTaskId,
    };

    const cb = this.getCircuitBreaker(taskType);
    if (this.options.enableCircuitBreaker && !cb.canExecute()) {
      this.emit({ kind: 'circuit-breaker-open', taskType });
      return this.rejectHandle(taskId, 'CIRCUIT_OPEN', 'Circuit breaker is open');
    }

    if (!this.queue.enqueue(task)) {
      this.emit({ kind: 'backpressure-rejected', taskType });
      return this.rejectHandle(taskId, 'BACKPRESSURE', 'Queue full');
    }

    // progress callback wrapper
    const offList: Array<() => void> = [];
    if (opts.onProgress) {
      offList.push(this.progress.on(taskId, opts.onProgress));
    }

    const result = new Promise<TResult>((resolve, reject) => {
      const attempt = (retryCount: number) => {
        this.runTask(task, token)
          .then((res) => {
            if (res.success) {
              resolve(res.result as TResult);
            } else {
              const canRetry =
                res.error?.recoverable !== false && retryCount < task.retryPolicy.maxRetries;
              if (canRetry) {
                const delay = this.calculateBackoff(retryCount, task.retryPolicy);
                setTimeout(() => attempt(retryCount + 1), delay);
              } else {
                this.dlq.add({ task, result: res, retryCount, deadAt: Date.now() });
                reject(this.toError(res.error, retryCount));
              }
            }
          })
          .catch((err) => {
            cb.recordFailure();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      };
      attempt(0);
    });

    result.finally(() => {
      this.tokens.delete(taskId);
      for (const off of offList) {
        off();
      }
    });

    return {
      taskId,
      result,
      progress: this.progress.iterable(taskId),
      cancel: (reason?: string) => {
        token.cancel(reason);
        this.cancel(taskId, reason);
      },
    };
  }

  cancel(taskId: string, reason?: string): boolean {
    const token = this.tokens.get(taskId);
    if (token) {
      token.cancel(reason);
      this.tokens.delete(taskId);
    }
    return this.queue.remove(taskId);
  }

  getTelemetry(): WorkerBusTelemetry {
    const stats = this.queue.stats();
    const total = this.processedTasks;
    return {
      queueDepth: stats.depthByPriority,
      activeWorkers: this.countActiveWorkers(),
      idleWorkers: this.countIdleWorkers(),
      processedTasks: this.processedTasks,
      failedTasks: this.failedTasks,
      deadLetterCount: this.dlq.count(),
      avgQueueTimeMs: total === 0 ? 0 : Math.round(this.totalQueueTimeMs / total),
      avgExecutionMs: total === 0 ? 0 : Math.round(this.totalExecutionMs / total),
      peakLatencyMs: this.peakLatencyMs,
      errorRate: total === 0 ? 0 : this.failedTasks / total,
      circuitBreakerStates: this.getCircuitBreakerStates(),
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  subscribe(listener: BusEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    this.running = false;
    for (const pool of this.pools.values()) {
      await pool.terminateAll();
    }
    this.pools.clear();
    this.progress.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async runTask<TResult>(
    task: WorkerTask,
    token: CancellationToken,
  ): Promise<TaskResult<TResult>> {
    const pool = this.resolvePool(task);
    if (!pool) {
      return {
        taskId: task.taskId,
        success: false,
        error: {
          code: 'NO_POOL',
          message: 'No pool supports required capabilities',
          recoverable: false,
          retryCount: 0,
        },
        latencyMs: 0,
        queueTimeMs: 0,
        layer: 'main',
      };
    }

    const worker = await pool.acquire(token.signal);
    const startedAt = performance.now();
    const queueTimeMs = Math.round(startedAt - task.createdAt);

    try {
      const port = worker.port;
      port.postMessage(
        createTaskMessage(task.taskId, task.taskType, task.payload, task.traceId, task.timeoutMs),
      );

      const result = await new Promise<TaskResult<TResult>>((resolve, _reject) => {
        let settled = false;
        const handler = (event: MessageEvent) => {
          if (settled) return;
          const msg = validateWorkerMessage(event.data);
          if (!msg) return;

          if (msg.kind === 'PROGRESS') {
            this.progress.emit(task.taskId, {
              taskId: task.taskId,
              taskType: task.taskType,
              stage: msg.stage,
              progress: msg.progress,
              message: msg.message,
              timestamp: Date.now(),
            });
          } else if (msg.kind === 'RESULT') {
            settled = true;
            port.removeEventListener('message', handler);
            const latencyMs = Math.round(performance.now() - startedAt);
            resolve({
              taskId: task.taskId,
              success: msg.success,
              result: msg.result as TResult,
              error: msg.error
                ? {
                    code: msg.error.code,
                    message: msg.error.message,
                    recoverable: true,
                    retryCount: 0,
                  }
                : undefined,
              latencyMs,
              queueTimeMs,
              workerId: worker.workerId,
              layer: 'web',
            });
          }
        };
        port.addEventListener('message', handler);

        const onAbort = () => {
          if (settled) return;
          settled = true;
          port.removeEventListener('message', handler);
          port.postMessage(createCancelMessage(task.taskId, 'Aborted'));
          resolve({
            taskId: task.taskId,
            success: false,
            error: {
              code: 'CANCELLED',
              message: 'Task was cancelled',
              recoverable: false,
              retryCount: 0,
            },
            latencyMs: Math.round(performance.now() - startedAt),
            queueTimeMs,
            workerId: worker.workerId,
            layer: 'web',
          });
        };
        token.signal.addEventListener('abort', onAbort, { once: true });
      });

      if (result.success) {
        this.getCircuitBreaker(task.taskType).recordSuccess();
        this.recordSuccess(result.latencyMs, queueTimeMs);
      } else {
        this.getCircuitBreaker(task.taskType).recordFailure();
        this.recordFailure(result.latencyMs);
      }
      return result;
    } finally {
      pool.release(worker);
    }
  }

  private resolvePool(task: WorkerTask): WorkerPool | undefined {
    // Simple capability matching: find first pool that supports all required capabilities
    for (const pool of this.pools.values()) {
      const hasAll = task.capabilities.every((cap) => pool.capabilities.includes(cap));
      if (hasAll) return pool;
    }
    return undefined;
  }

  private getCircuitBreaker(taskType: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(taskType);
    if (!cb) {
      cb = new CircuitBreaker(
        this.options.circuitBreakerThreshold,
        60_000,
        this.options.circuitBreakerRecoveryMs,
      );
      this.circuitBreakers.set(taskType, cb);
    }
    return cb;
  }

  private getCircuitBreakerStates(): Record<string, 'closed' | 'open' | 'half-open'> {
    const out: Record<string, 'closed' | 'open' | 'half-open'> = {};
    for (const [type, cb] of this.circuitBreakers) {
      out[type] = cb.getState();
    }
    return out;
  }

  private rejectHandle<TResult>(
    taskId: string,
    code: string,
    message: string,
  ): TaskHandle<TResult> {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return {
      taskId,
      result: Promise.reject(err),
      progress: this.progress.iterable(taskId),
      cancel: () => {
        /* no-op */
      },
    };
  }

  private toError(info: TaskErrorInfo | undefined, retryCount: number): Error {
    const e = new Error(info?.message ?? 'Task failed') as Error & {
      code: string;
      recoverable: boolean;
      retryCount: number;
    };
    e.code = info?.code ?? 'FAILED';
    e.recoverable = info?.recoverable ?? false;
    e.retryCount = retryCount;
    return e;
  }

  private calculateBackoff(retryCount: number, policy: WorkerTask['retryPolicy']): number {
    const base = policy.backoffMs * 2 ** retryCount;
    const capped = Math.min(base, policy.maxBackoffMs);
    const jitter = policy.jitter ? Math.random() * capped * 0.3 : 0;
    return Math.round(capped + jitter);
  }

  private recordSuccess(latencyMs: number, queueTimeMs: number): void {
    this.processedTasks++;
    this.lastSuccessAt = Date.now();
    this.totalExecutionMs += latencyMs;
    this.totalQueueTimeMs += queueTimeMs;
    if (latencyMs > this.peakLatencyMs) this.peakLatencyMs = latencyMs;
  }

  private recordFailure(latencyMs: number): void {
    this.processedTasks++;
    this.failedTasks++;
    this.totalExecutionMs += latencyMs;
  }

  private countActiveWorkers(): number {
    let sum = 0;
    for (const pool of this.pools.values()) {
      sum += pool.getHealth().busyWorkers;
    }
    return sum;
  }

  private countIdleWorkers(): number {
    let sum = 0;
    for (const pool of this.pools.values()) {
      sum += pool.getHealth().idleWorkers;
    }
    return sum;
  }

  private emit(event: BusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* isolated */
      }
    }
  }

  private schedulePump(): void {
    if (this.pumpScheduled || !this.running) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      if (!this.running) return;
      const task = this.queue.peek();
      if (task) {
        // QNBS-v3: Fire-and-forget pump; each enqueue already starts its own execution chain.
        //          This microtask pump is only for future scheduler extensions.
        this.schedulePump();
      }
    });
  }
}
