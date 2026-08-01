// QNBS-v3: WorkerBus v2 uses one bounded priority scheduler for queueing, retries, and dispatch.

import { createLogger } from '../../../services/logger';
import { type CancellationToken, createCancellationToken } from './cancellation';
import { CircuitBreaker } from './circuitBreaker';
import { DeadLetterQueue } from './deadLetterQueue';
import { createCancelMessage, createTaskMessage, validateWorkerMessage } from './messageBus';
import { ProgressEmitter } from './progressEmitter';
import type { WorkerMessage } from './schemas';
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
import { type PooledWorkerInstance, WorkerPool } from './workerPool';

const log = createLogger('worker-bus');

interface PendingTask {
  readonly task: WorkerTask;
  readonly token: CancellationToken;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly offProgress: (() => void) | undefined;
  retryCount: number;
  watchdog: ReturnType<typeof setTimeout> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  active: { pool: WorkerPool; worker: PooledWorkerInstance } | undefined;
  settled: boolean;
}

export class WorkerBus {
  private readonly queue: PriorityTaskQueue;
  private readonly pools = new Map<string, WorkerPool>();
  private readonly poolAvailabilityOff = new Map<string, () => void>();
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly dlq: DeadLetterQueue;
  private readonly progress = new ProgressEmitter();
  private readonly tokens = new Map<string, CancellationToken>();
  private readonly pendingTasks = new Map<string, PendingTask>();
  private readonly taskPools = new Map<string, string>();
  private readonly listeners = new Set<BusEventListener>();
  private running = true;
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
  }

  hasPool(poolId: string): boolean {
    return this.pools.has(poolId);
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
    const pool = new WorkerPool(poolId, capabilities, opts);
    this.pools.set(poolId, pool);
    this.poolAvailabilityOff.set(
      poolId,
      pool.onAvailable(() => this.schedulePump()),
    );
    this.schedulePump();
  }

  enqueue<TPayload, TResult>(
    taskType: string,
    payload: TPayload,
    opts: EnqueueOptions = {},
  ): TaskHandle<TResult> {
    const taskId = crypto.randomUUID();
    const task = this.createTask(taskId, taskType, payload, opts);
    const circuitBreaker = this.getCircuitBreaker(taskType);
    if (!this.running) return this.rejectHandle(taskId, 'SHUTDOWN', 'WorkerBus is shut down');
    if (this.options.enableCircuitBreaker && !circuitBreaker.canExecute()) {
      this.emit({ kind: 'circuit-breaker-open', taskType });
      return this.rejectHandle(taskId, 'CIRCUIT_OPEN', 'Circuit breaker is open');
    }
    if (!this.queue.enqueue(task)) {
      const hardSaturation = task.priority === 'critical';
      this.emit({
        kind: hardSaturation ? 'hard-backpressure-rejected' : 'backpressure-rejected',
        taskType,
      });
      return this.rejectHandle(taskId, 'BACKPRESSURE', 'Queue full');
    }

    const token = createCancellationToken();
    this.tokens.set(taskId, token);
    let resolveResult: (value: unknown) => void = () => {};
    let rejectResult: (error: Error) => void = () => {};
    const result = new Promise<TResult>((resolve, reject) => {
      resolveResult = (value) => resolve(value as TResult);
      rejectResult = reject;
    });
    const pending: PendingTask = {
      task,
      token,
      resolve: resolveResult,
      reject: rejectResult,
      offProgress: opts.onProgress ? this.progress.on(taskId, opts.onProgress) : undefined,
      retryCount: 0,
      watchdog: undefined,
      retryTimer: undefined,
      active: undefined,
      settled: false,
    };
    this.pendingTasks.set(taskId, pending);
    this.armWatchdog(pending);
    this.schedulePump();

    return {
      taskId,
      result,
      progress: this.progress.iterable(taskId),
      cancel: (reason?: string) => {
        this.cancel(taskId, reason);
      },
    };
  }

  cancel(taskId: string, reason?: string): boolean {
    const pending = this.pendingTasks.get(taskId);
    if (!pending || pending.settled) return false;
    this.queue.remove(taskId);
    pending.token.cancel(reason);
    this.settleFailure(pending, {
      code: 'CANCELLED',
      message: 'Task was cancelled',
      recoverable: false,
      retryCount: pending.retryCount,
    });
    return true;
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
    if (!this.running) return;
    this.running = false;
    for (const pending of [...this.pendingTasks.values()]) {
      pending.token.cancel('WorkerBus shut down');
      this.settleFailure(pending, {
        code: 'SHUTDOWN',
        message: 'WorkerBus shut down',
        recoverable: false,
        retryCount: pending.retryCount,
      });
    }
    for (const off of this.poolAvailabilityOff.values()) off();
    this.poolAvailabilityOff.clear();
    for (const pool of this.pools.values()) await pool.terminateAll();
    this.pools.clear();
    this.progress.clear();
  }

  async terminatePool(poolId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (!pool) return;
    for (const pending of [...this.pendingTasks.values()]) {
      if (pending.active?.pool === pool || this.resolvePool(pending.task) === pool) {
        this.cancel(pending.task.taskId, 'Pool terminated');
      }
    }
    this.poolAvailabilityOff.get(poolId)?.();
    this.poolAvailabilityOff.delete(poolId);
    await pool.terminateAll();
    this.pools.delete(poolId);
    this.schedulePump();
  }

  private createTask<TPayload>(
    taskId: string,
    taskType: string,
    payload: TPayload,
    opts: EnqueueOptions,
  ): WorkerTask<TPayload> {
    return {
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
      traceId: opts.parentTaskId ? `${opts.parentTaskId}:${taskId}` : taskId,
      parentTaskId: opts.parentTaskId,
    };
  }

  private pump(): void {
    while (this.running) {
      let selectedPool: WorkerPool | undefined;
      let selectedWorker: PooledWorkerInstance | undefined;
      const task = this.queue.dequeueFirst((candidate) => {
        const pending = this.pendingTasks.get(candidate.taskId);
        if (!pending || pending.settled) return true;
        const pool = this.resolvePool(candidate);
        if (!pool) return true;
        const worker = pool.tryAcquire();
        if (!worker) return false;
        selectedPool = pool;
        selectedWorker = worker;
        return true;
      });
      if (!task) return;
      const pending = this.pendingTasks.get(task.taskId);
      if (!pending || pending.settled) continue;
      if (!selectedPool || !selectedWorker) {
        this.handleAttemptResult(pending, this.noPoolResult(task));
        continue;
      }
      pending.active = { pool: selectedPool, worker: selectedWorker };
      this.taskPools.set(task.taskId, selectedPool.poolId);
      void this.executeAttempt(pending, selectedPool, selectedWorker);
    }
  }

  private async executeAttempt(
    pending: PendingTask,
    pool: WorkerPool,
    worker: PooledWorkerInstance,
  ): Promise<void> {
    try {
      const result = await this.runTask(pending.task, pending.token, pool, worker);
      if (!pending.settled) this.handleAttemptResult(pending, result);
    } catch (error) {
      if (!pending.settled) {
        this.getCircuitBreaker(pending.task.taskType).recordFailure();
        this.settleError(pending, error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (pending.active?.worker === worker) pending.active = undefined;
      this.taskPools.delete(pending.task.taskId);
      this.schedulePump();
    }
  }

  private async runTask<TResult>(
    task: WorkerTask,
    token: CancellationToken,
    pool: WorkerPool,
    worker: PooledWorkerInstance,
  ): Promise<TaskResult<TResult>> {
    return this.runOnPool(task, token, pool, worker, () => {
      const pending = this.pendingTasks.get(task.taskId);
      if (pending && !pending.settled) this.armWatchdog(pending);
    });
  }

  private async runOnPool<TResult>(
    task: WorkerTask,
    token: CancellationToken,
    pool: WorkerPool,
    worker: PooledWorkerInstance,
    onProgress: () => void,
  ): Promise<TaskResult<TResult>> {
    const startedAt = performance.now();
    let timedOut = false;
    try {
      const result = await this.waitForWorkerResult<TResult>(
        task,
        token,
        worker,
        startedAt,
        onProgress,
      );
      timedOut = result.error?.code === 'TIMEOUT';
      return result;
    } finally {
      if (timedOut) pool.terminateWorker(worker.workerId);
      else if (token.reason !== 'Task inactivity timeout') pool.release(worker);
    }
  }

  private waitForWorkerResult<TResult>(
    task: WorkerTask,
    token: CancellationToken,
    worker: PooledWorkerInstance,
    startedAt: number,
    onProgress: () => void,
  ): Promise<TaskResult<TResult>> {
    const queueTimeMs = Math.round(startedAt - task.createdAt);
    const port = worker.port;
    port.postMessage(
      createTaskMessage(task.taskId, task.taskType, task.payload, task.traceId, task.timeoutMs),
    );
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        port.removeEventListener('message', handler);
        token.signal.removeEventListener('abort', handleAbort);
      };
      const finish = (result: TaskResult<TResult>) => {
        if (settled) return;
        cleanup();
        resolve(result);
      };
      const handleAbort = () => {
        port.postMessage(createCancelMessage(task.taskId, token.reason ?? 'Aborted'));
        finish({
          taskId: task.taskId,
          success: false,
          error: {
            code: 'CANCELLED',
            message: token.reason ?? 'Task was cancelled',
            recoverable: false,
            retryCount: 0,
          },
          latencyMs: Math.round(performance.now() - startedAt),
          queueTimeMs,
          workerId: worker.workerId,
          layer: 'web',
        });
      };
      const handler = (event: MessageEvent) => {
        const message = validateWorkerMessage(event.data);
        if (!message || message.taskId !== task.taskId) return;
        if (message.kind === 'PROGRESS') {
          onProgress();
          this.progress.emit(task.taskId, {
            taskId: task.taskId,
            taskType: task.taskType,
            stage: message.stage,
            progress: message.progress,
            message: message.message,
            timestamp: Date.now(),
          });
        } else if (message.kind === 'RESULT') {
          finish(
            this.workerMessageToResult<TResult>(task, worker, message, startedAt, queueTimeMs),
          );
        }
      };
      port.addEventListener('message', handler);
      token.signal.addEventListener('abort', handleAbort, { once: true });
      if (token.signal.aborted) handleAbort();
    });
  }

  private workerMessageToResult<TResult>(
    task: WorkerTask,
    worker: PooledWorkerInstance,
    message: Extract<WorkerMessage, { kind: 'RESULT' }>,
    startedAt: number,
    queueTimeMs: number,
  ): TaskResult<TResult> {
    return {
      taskId: task.taskId,
      success: message.success,
      result: message.result as TResult,
      error: message.error
        ? {
            code: message.error.code,
            message: message.error.message,
            recoverable: true,
            retryCount: 0,
          }
        : undefined,
      latencyMs: Math.round(performance.now() - startedAt),
      queueTimeMs,
      workerId: worker.workerId,
      layer: 'web',
    };
  }

  private handleAttemptResult(pending: PendingTask, result: TaskResult): void {
    if (result.success) {
      this.getCircuitBreaker(pending.task.taskType).recordSuccess();
      this.recordSuccess(result.latencyMs, result.queueTimeMs);
      this.settleSuccess(pending, result.result);
      return;
    }
    this.getCircuitBreaker(pending.task.taskType).recordFailure();
    const canRetry =
      result.error?.recoverable !== false &&
      pending.retryCount < pending.task.retryPolicy.maxRetries &&
      !pending.token.isCancelled;
    if (canRetry) {
      this.armWatchdog(pending);
      const delay = this.calculateBackoff(pending.retryCount, pending.task.retryPolicy);
      pending.retryCount++;
      pending.retryTimer = setTimeout(() => this.requeueRetry(pending), delay);
      return;
    }
    this.recordFailure(result.latencyMs);
    this.dlq.add({
      task: pending.task,
      result,
      retryCount: pending.retryCount,
      deadAt: Date.now(),
    });
    this.settleFailure(pending, result.error);
  }

  private requeueRetry(pending: PendingTask): void {
    pending.retryTimer = undefined;
    if (pending.settled || pending.token.isCancelled) return;
    if (!this.queue.enqueue(pending.task)) {
      this.settleFailure(pending, {
        code: 'BACKPRESSURE',
        message: 'Queue full while retrying task',
        recoverable: false,
        retryCount: pending.retryCount,
      });
      return;
    }
    this.schedulePump();
  }

  private armWatchdog(pending: PendingTask): void {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.watchdog = setTimeout(() => this.handleWatchdog(pending), pending.task.timeoutMs);
  }

  private handleWatchdog(pending: PendingTask): void {
    if (pending.settled) return;
    this.queue.remove(pending.task.taskId);
    const active = pending.active;
    pending.token.cancel('Task inactivity timeout');
    if (active) active.pool.terminateWorker(active.worker.workerId);
    const latencyMs = Math.round(performance.now() - pending.task.createdAt);
    const error = {
      code: 'TIMEOUT',
      message: `No response from the worker for ${pending.task.timeoutMs}ms (inactivity watchdog, including queue wait)`,
      recoverable: true,
      retryCount: pending.retryCount,
    };
    const result: TaskResult = {
      taskId: pending.task.taskId,
      success: false,
      error,
      latencyMs,
      queueTimeMs: active ? Math.round(performance.now() - pending.task.createdAt) : latencyMs,
      ...(active ? { workerId: active.worker.workerId } : {}),
      layer: active ? 'web' : 'main',
    };
    this.getCircuitBreaker(pending.task.taskType).recordFailure();
    this.recordFailure(latencyMs);
    this.dlq.add({
      task: pending.task,
      result,
      retryCount: pending.retryCount,
      deadAt: Date.now(),
    });
    this.settleFailure(pending, error);
  }

  private settleSuccess(pending: PendingTask, value: unknown): void {
    if (!this.finalize(pending)) return;
    pending.resolve(value);
  }

  private settleFailure(pending: PendingTask, info: TaskErrorInfo | undefined): void {
    if (!this.finalize(pending)) return;
    pending.reject(this.toError(info, pending.retryCount));
  }

  private settleError(pending: PendingTask, error: Error): void {
    if (!this.finalize(pending)) return;
    pending.reject(error);
  }

  private finalize(pending: PendingTask): boolean {
    if (pending.settled) return false;
    pending.settled = true;
    this.queue.remove(pending.task.taskId);
    if (pending.watchdog) clearTimeout(pending.watchdog);
    if (pending.retryTimer) clearTimeout(pending.retryTimer);
    pending.offProgress?.();
    this.progress.complete(pending.task.taskId);
    this.tokens.delete(pending.task.taskId);
    this.pendingTasks.delete(pending.task.taskId);
    this.taskPools.delete(pending.task.taskId);
    return true;
  }

  private noPoolResult(task: WorkerTask): TaskResult {
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
      queueTimeMs: Math.round(performance.now() - task.createdAt),
      layer: 'main',
    };
  }

  private resolvePool(task: WorkerTask): WorkerPool | undefined {
    for (const pool of this.pools.values()) {
      if (task.capabilities.every((capability) => pool.capabilities.includes(capability))) {
        return pool;
      }
    }
    return undefined;
  }

  private getCircuitBreaker(taskType: string): CircuitBreaker {
    let circuitBreaker = this.circuitBreakers.get(taskType);
    if (!circuitBreaker) {
      circuitBreaker = new CircuitBreaker(
        this.options.circuitBreakerThreshold,
        60_000,
        this.options.circuitBreakerRecoveryMs,
      );
      this.circuitBreakers.set(taskType, circuitBreaker);
    }
    return circuitBreaker;
  }

  private getCircuitBreakerStates(): Record<string, 'closed' | 'open' | 'half-open'> {
    const states: Record<string, 'closed' | 'open' | 'half-open'> = {};
    for (const [taskType, circuitBreaker] of this.circuitBreakers) {
      states[taskType] = circuitBreaker.getState();
    }
    return states;
  }

  private rejectHandle<TResult>(
    taskId: string,
    code: string,
    message: string,
  ): TaskHandle<TResult> {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return {
      taskId,
      result: Promise.reject(error),
      progress: this.emptyProgress(),
      cancel: () => {},
    };
  }

  private emptyProgress(): AsyncIterable<never> {
    return {
      async *[Symbol.asyncIterator]() {
        // QNBS-v3: rejected enqueues expose a completed stream without registering a listener.
      },
    };
  }

  private toError(info: TaskErrorInfo | undefined, retryCount: number): Error {
    const error = new Error(info?.message ?? 'Task failed') as Error & {
      code: string;
      recoverable: boolean;
      retryCount: number;
    };
    error.code = info?.code ?? 'FAILED';
    error.recoverable = info?.recoverable ?? false;
    error.retryCount = retryCount;
    return error;
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
    let count = 0;
    for (const pool of this.pools.values()) count += pool.getHealth().busyWorkers;
    return count;
  }

  private countIdleWorkers(): number {
    let count = 0;
    for (const pool of this.pools.values()) count += pool.getHealth().idleWorkers;
    return count;
  }

  private emit(event: BusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // QNBS-v3: subscriber failures must not interrupt scheduling or other subscribers.
      }
    }
  }

  private schedulePump(): void {
    if (this.pumpScheduled || !this.running) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }
}
