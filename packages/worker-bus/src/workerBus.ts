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
import { DEFAULT_RETRY_POLICY } from './types';
import { type PooledWorkerInstance, WorkerPool } from './workerPool';

const log = createLogger('worker-bus');

// QNBS-v3: attempt-local cancellation preserves logical task retries while replacing wedged workers.
interface ActiveAttempt {
  readonly pool: WorkerPool;
  readonly worker: PooledWorkerInstance;
  readonly token: CancellationToken;
  readonly startedAt: number;
  timedOut: boolean;
}

interface PendingTask {
  readonly task: WorkerTask;
  readonly token: CancellationToken;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly offProgress: (() => void) | undefined;
  retryCount: number;
  watchdog: ReturnType<typeof setTimeout> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  active: ActiveAttempt | undefined;
  settled: boolean;
}

interface DispatchSelection {
  task: WorkerTask | undefined;
  pool: WorkerPool | undefined;
  worker: PooledWorkerInstance | undefined;
  acquisitionError: Error | undefined;
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
    const rejectedHandle = this.getRejectedHandle<TResult>(task);
    if (rejectedHandle) return rejectedHandle;
    if (!this.queue.enqueue(task)) return this.rejectForBackpressure<TResult>(task);

    return this.createPendingHandle<TResult>(task, opts);
  }

  private createPendingHandle<TResult>(
    task: WorkerTask,
    opts: EnqueueOptions,
  ): TaskHandle<TResult> {
    const taskId = task.taskId;

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
    pending.active?.token.cancel(reason);
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
      pending.active?.token.cancel('WorkerBus shut down');
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
      priority: this.withDefault(opts.priority, 'normal'),
      target: this.withDefault(opts.target, 'any'),
      capabilities: this.withDefault(opts.capabilities, []),
      transferables: opts.transferables,
      createdAt: Date.now(),
      timeoutMs: this.withDefault(opts.timeoutMs, 300_000),
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...opts.retryPolicy },
      traceId: this.createTraceId(taskId, opts.parentTaskId),
      parentTaskId: opts.parentTaskId,
    };
  }

  private getRejectedHandle<TResult>(task: WorkerTask): TaskHandle<TResult> | undefined {
    if (!this.running) {
      return this.rejectHandle(task.taskId, 'SHUTDOWN', 'WorkerBus is shut down');
    }
    const circuitBreaker = this.getCircuitBreaker(task.taskType);
    if (!this.options.enableCircuitBreaker || circuitBreaker.canExecute()) return undefined;
    this.emit({ kind: 'circuit-breaker-open', taskType: task.taskType });
    return this.rejectHandle(task.taskId, 'CIRCUIT_OPEN', 'Circuit breaker is open');
  }

  private rejectForBackpressure<TResult>(task: WorkerTask): TaskHandle<TResult> {
    this.emitBackpressure(task);
    return this.rejectHandle(task.taskId, 'BACKPRESSURE', 'Queue full');
  }

  private emitBackpressure(task: WorkerTask): void {
    this.emit({
      kind: task.priority === 'critical' ? 'hard-backpressure-rejected' : 'backpressure-rejected',
      taskType: task.taskType,
    });
  }

  private withDefault<T>(value: T | undefined, fallback: T): T {
    return value === undefined ? fallback : value;
  }

  private createTraceId(taskId: string, parentTaskId: string | undefined): string {
    return parentTaskId ? `${parentTaskId}:${taskId}` : taskId;
  }

  private pump(): void {
    while (this.running) {
      const selection = this.dequeueRunnableTask();
      if (!selection.task) return;
      this.dispatchSelection(selection);
    }
  }

  private dequeueRunnableTask(): DispatchSelection {
    const selection: DispatchSelection = {
      task: undefined,
      pool: undefined,
      worker: undefined,
      acquisitionError: undefined,
    };
    selection.task = this.queue.dequeueFirst((candidate) =>
      this.selectCandidate(candidate, selection),
    );
    return selection;
  }

  private selectCandidate(candidate: WorkerTask, selection: DispatchSelection): boolean {
    selection.pool = undefined;
    selection.worker = undefined;
    selection.acquisitionError = undefined;
    const pending = this.pendingTasks.get(candidate.taskId);
    if (!pending || pending.settled) return true;
    const pool = this.resolvePool(candidate);
    if (!pool) return true;
    selection.pool = pool;
    return this.trySelectWorker(pool, selection);
  }

  private trySelectWorker(pool: WorkerPool, selection: DispatchSelection): boolean {
    try {
      selection.worker = pool.tryAcquire();
      return Boolean(selection.worker);
    } catch (error) {
      selection.acquisitionError = this.asError(error);
      return true;
    }
  }

  private dispatchSelection(selection: DispatchSelection): void {
    const task = selection.task;
    if (!task) return;
    const pending = this.pendingTasks.get(task.taskId);
    if (!pending || pending.settled) return;
    const failureResult = this.dispatchFailureResult(task, selection);
    if (failureResult) {
      this.handleAttemptResult(pending, failureResult);
      return;
    }
    this.startAttempt(pending, task, selection);
  }

  private dispatchFailureResult(
    task: WorkerTask,
    selection: DispatchSelection,
  ): TaskResult | undefined {
    if (selection.acquisitionError) {
      return this.acquisitionFailureResult(task, selection.acquisitionError);
    }
    if (!selection.pool || !selection.worker) return this.noPoolResult(task);
    return undefined;
  }

  private startAttempt(pending: PendingTask, task: WorkerTask, selection: DispatchSelection): void {
    const { pool, worker } = selection;
    if (!pool || !worker) return;
    const attempt: ActiveAttempt = {
      pool,
      worker,
      token: createCancellationToken(),
      startedAt: Date.now(),
      timedOut: false,
    };
    pending.active = attempt;
    this.taskPools.set(task.taskId, pool.poolId);
    void this.executeAttempt(pending, attempt);
  }

  private async executeAttempt(pending: PendingTask, attempt: ActiveAttempt): Promise<void> {
    try {
      const result = await this.runTask(
        pending.task,
        attempt.token,
        attempt.pool,
        attempt.worker,
        attempt,
      );
      this.acceptAttemptResult(pending, attempt, result);
    } catch (error) {
      this.handleAttemptException(pending, attempt, error);
    } finally {
      this.finishAttempt(pending, attempt);
    }
  }

  private acceptAttemptResult(
    pending: PendingTask,
    attempt: ActiveAttempt,
    result: TaskResult,
  ): void {
    if (!this.isCurrentAttempt(pending, attempt) || attempt.timedOut) return;
    this.handleAttemptResult(pending, result);
  }

  private handleAttemptException(
    pending: PendingTask,
    attempt: ActiveAttempt,
    error: unknown,
  ): void {
    if (!this.isCurrentAttempt(pending, attempt) || attempt.timedOut) return;
    this.handleAttemptResult(
      pending,
      this.executionFailureResult(pending.task, this.asError(error)),
    );
  }

  private finishAttempt(pending: PendingTask, attempt: ActiveAttempt): void {
    if (pending.active === attempt) {
      pending.active = undefined;
      this.taskPools.delete(pending.task.taskId);
    }
    this.schedulePump();
  }

  private isCurrentAttempt(pending: PendingTask, attempt: ActiveAttempt): boolean {
    return !pending.settled && pending.active === attempt;
  }

  private async runTask<TResult>(
    task: WorkerTask,
    token: CancellationToken,
    pool: WorkerPool,
    worker: PooledWorkerInstance,
    attempt: ActiveAttempt,
  ): Promise<TaskResult<TResult>> {
    return this.runOnPool(task, token, pool, worker, attempt, () => {
      const pending = this.pendingTasks.get(task.taskId);
      if (pending && !pending.settled) this.armWatchdog(pending);
    });
  }

  private async runOnPool<TResult>(
    task: WorkerTask,
    token: CancellationToken,
    pool: WorkerPool,
    worker: PooledWorkerInstance,
    attempt: ActiveAttempt,
    onProgress: () => void,
  ): Promise<TaskResult<TResult>> {
    const startedAt = Date.now();
    try {
      return await this.waitForWorkerResult<TResult>(task, token, worker, startedAt, onProgress);
    } finally {
      if (!attempt.timedOut) pool.release(worker);
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
      const removeListeners: Array<() => void> = [];

      function cleanup(): void {
        settled = true;
        for (const removeListener of removeListeners) removeListener();
      }

      function finish(result: TaskResult<TResult>): void {
        if (settled) return;
        cleanup();
        resolve(result);
      }

      function handleAbort(): void {
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
          latencyMs: Math.round(Date.now() - startedAt),
          queueTimeMs,
          workerId: worker.workerId,
          layer: 'web',
        });
      }

      const handler = (event: MessageEvent): void => {
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
      removeListeners.push(
        () => port.removeEventListener('message', handler),
        () => token.signal.removeEventListener('abort', handleAbort),
      );
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
      latencyMs: Math.round(Date.now() - startedAt),
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
      this.clearWatchdog(pending);
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
      this.emitBackpressure(pending.task);
      this.handleAttemptResult(pending, this.retryBackpressureResult(pending));
      return;
    }
    this.armWatchdog(pending);
    this.schedulePump();
  }

  private armWatchdog(pending: PendingTask): void {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    pending.watchdog = setTimeout(() => this.handleWatchdog(pending), pending.task.timeoutMs);
  }

  private clearWatchdog(pending: PendingTask): void {
    if (!pending.watchdog) return;
    clearTimeout(pending.watchdog);
    pending.watchdog = undefined;
  }

  private handleWatchdog(pending: PendingTask): void {
    if (pending.settled) return;
    pending.watchdog = undefined;
    this.queue.remove(pending.task.taskId);
    const active = pending.active;
    this.expireAttempt(active);
    this.handleAttemptResult(pending, this.timeoutResult(pending, active));
  }

  private expireAttempt(active: ActiveAttempt | undefined): void {
    if (!active) return;
    active.timedOut = true;
    active.token.cancel('Task inactivity timeout');
    try {
      active.pool.terminateWorker(active.worker.workerId);
    } catch (error) {
      // QNBS-v3: replacement failure must not bypass timeout settlement on constrained devices.
      log.warn('Failed to replace a timed-out worker', this.asError(error).message);
    }
  }

  private timeoutResult(pending: PendingTask, active: ActiveAttempt | undefined): TaskResult {
    if (active) return this.activeTimeoutResult(pending, active);
    const latencyMs = this.elapsedSince(pending.task.createdAt);
    return {
      taskId: pending.task.taskId,
      success: false,
      error: this.timeoutError(pending),
      latencyMs,
      queueTimeMs: latencyMs,
      layer: 'main',
    };
  }

  private activeTimeoutResult(pending: PendingTask, active: ActiveAttempt): TaskResult {
    return {
      taskId: pending.task.taskId,
      success: false,
      error: this.timeoutError(pending),
      latencyMs: this.elapsedSince(active.startedAt),
      queueTimeMs: this.elapsedBetween(pending.task.createdAt, active.startedAt),
      workerId: active.worker.workerId,
      layer: 'web',
    };
  }

  private timeoutError(pending: PendingTask): TaskErrorInfo {
    return {
      code: 'TIMEOUT',
      message: `No response from the worker for ${pending.task.timeoutMs}ms (inactivity watchdog, including queue wait)`,
      recoverable: true,
      retryCount: pending.retryCount,
    };
  }

  private settleSuccess(pending: PendingTask, value: unknown): void {
    if (!this.finalize(pending)) return;
    pending.resolve(value);
  }

  private settleFailure(pending: PendingTask, info: TaskErrorInfo | undefined): void {
    if (!this.finalize(pending)) return;
    pending.reject(this.toError(info, pending.retryCount));
  }

  private finalize(pending: PendingTask): boolean {
    if (pending.settled) return false;
    pending.settled = true;
    this.queue.remove(pending.task.taskId);
    this.clearWatchdog(pending);
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
      queueTimeMs: Math.round(Date.now() - task.createdAt),
      layer: 'main',
    };
  }

  private acquisitionFailureResult(task: WorkerTask, error: Error): TaskResult {
    return this.internalFailureResult(task, 'WORKER_SPAWN_FAILED', error);
  }

  private executionFailureResult(task: WorkerTask, error: Error): TaskResult {
    return this.internalFailureResult(task, 'WORKER_EXECUTION_FAILED', error);
  }

  private internalFailureResult(task: WorkerTask, code: string, error: Error): TaskResult {
    const latencyMs = this.elapsedSince(task.createdAt);
    return {
      taskId: task.taskId,
      success: false,
      error: {
        code,
        message: error.message,
        recoverable: true,
        retryCount: 0,
      },
      latencyMs,
      queueTimeMs: latencyMs,
      layer: 'main',
    };
  }

  private retryBackpressureResult(pending: PendingTask): TaskResult {
    const latencyMs = this.elapsedSince(pending.task.createdAt);
    return {
      taskId: pending.task.taskId,
      success: false,
      error: {
        code: 'BACKPRESSURE',
        message: 'Queue full while retrying task',
        recoverable: false,
        retryCount: pending.retryCount,
      },
      latencyMs,
      queueTimeMs: latencyMs,
      layer: 'main',
    };
  }

  private elapsedSince(startedAt: number): number {
    return this.elapsedBetween(startedAt, Date.now());
  }

  private elapsedBetween(startedAt: number, endedAt: number): number {
    return Math.max(0, Math.round(endedAt - startedAt));
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
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
