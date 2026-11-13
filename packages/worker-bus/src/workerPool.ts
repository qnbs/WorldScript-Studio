// QNBS-v3: Worker pool with MessageChannel streaming, health checks, and auto-restart.

import { createLogger } from '../../../services/logger';
import {
  WORKER_IDLE_TIMEOUT_MS,
  WORKER_PING_INTERVAL_MS,
  WORKER_PONG_TIMEOUT_MS,
} from './constants';
import { createPingMessage } from './messageBus';
import type { PooledWorker, WorkerCapability, WorkerPoolOptions } from './types';

const log = createLogger('worker-bus:pool');

/** Delay before the nth consecutive respawn (the first is immediate); past the list the pool gives up. */
const RESPAWN_BACKOFF_MS = [0, 1_000, 4_000] as const;

/** The pool's worker factory: `createWorker` when given, else a module worker of `workerScript`. */
function workerFactory(poolId: string, options: WorkerPoolOptions): () => Worker {
  const { createWorker, workerScript } = options;
  if (createWorker) return createWorker;
  if (!workerScript) throw new Error(`Worker pool ${poolId} needs createWorker or workerScript`);
  return () => new Worker(new URL(workerScript, import.meta.url), { type: 'module' });
}

export interface PooledWorkerInstance extends PooledWorker {
  readonly worker: Worker;
  readonly channel: MessageChannel;
  readonly port: MessagePort;
}

interface PoolEntry {
  instance: PooledWorkerInstance;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setTimeout> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  /** Waits for the PONG of the latest ping; removed with the health check. */
  pongHandler: ((event: MessageEvent) => void) | null;
}

interface AcquireWaiter {
  readonly id: symbol;
  readonly resolve: (worker: PooledWorkerInstance) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

export class WorkerPool {
  private entries: PoolEntry[] = [];
  private shutdownFlag = false;
  /** Worker starts that crashed without ever answering a ping or finishing a task. */
  private consecutiveCrashes = 0;
  private failure: Error | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly availabilityListeners = new Set<() => void>();
  private readonly acquireWaiters: AcquireWaiter[] = [];
  private readonly makeWorker: () => Worker;

  constructor(
    public readonly poolId: string,
    public readonly capabilities: readonly WorkerCapability[],
    public readonly options: WorkerPoolOptions,
  ) {
    this.makeWorker = workerFactory(poolId, options);
  }

  async acquire(signal?: AbortSignal): Promise<PooledWorkerInstance> {
    const worker = this.tryAcquire();
    if (worker) return worker;
    this.assertCanWait(signal);

    return new Promise((resolve, reject) => {
      const waiterId = Symbol('worker-pool-waiter');
      const onAbort = () => {
        this.abortWaiter(waiterId);
      };
      const waiter: AcquireWaiter = { id: waiterId, resolve, reject, signal, onAbort };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.acquireWaiters.push(waiter);
    });
  }

  private assertCanWait(signal?: AbortSignal): void {
    if (this.failure) throw this.failure;
    if (this.shutdownFlag) throw new Error('Pool is shutting down');
    if (signal?.aborted) throw new Error('Aborted');
  }

  tryAcquire(): PooledWorkerInstance | undefined {
    if (this.shutdownFlag) return undefined;
    // QNBS-v3 (#1272): the WorkerBus treats undefined as "busy, wait"; a failed pool throws, so queued tasks get its error.
    if (this.failure) throw this.failure;
    const idle = this.entries.find((entry) => entry.instance.state === 'idle');
    if (idle) {
      this.setBusy(idle.instance.workerId);
      this.clearIdleTimer(idle.instance);
      return idle.instance;
    }
    // QNBS-v3 (#1272): a start during a pending respawn backoff would skip the delay; waiters are served by the respawn.
    if (this.respawnTimer || this.entries.length >= this.options.maxWorkers) return undefined;
    const worker = this.spawnWorker();
    this.setBusy(worker.workerId);
    return worker;
  }

  /**
   * A worker of this pool answered a task: its script runs, so earlier crashes and a pool failure no longer count.
   * A release alone proves nothing (a cancelled task is released without an answer, #1278).
   */
  markWorkerHealthy(workerId: string): void {
    if (this.entries.some((entry) => entry.instance.workerId === workerId)) this.markHealthy();
  }

  onAvailable(listener: () => void): () => void {
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  release(worker: PooledWorkerInstance): void {
    const entry = this.entries.find((e) => e.instance.workerId === worker.workerId);
    if (!entry) return;
    if (this.shutdownFlag) {
      this.terminateEntry(entry);
      return;
    }
    this.setIdle(worker.workerId);
    entry.idleTimer = setTimeout(() => {
      if (this.entries.length > this.options.minWorkers) {
        this.terminateEntry(entry);
      }
    }, WORKER_IDLE_TIMEOUT_MS);
    this.notifyAvailable();
  }

  async terminateAll(): Promise<void> {
    this.shutdownFlag = true;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    for (const waiter of this.acquireWaiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Pool is shutting down'));
    }
    for (const entry of this.entries) {
      this.terminateEntry(entry);
    }
    this.entries = [];
    this.notifyAvailable();
  }

  /**
   * Force-terminate one worker and respawn a replacement (pool stays at capacity).
   * QNBS-v3: a task that missed its timeoutMs deadline may have wedged the worker in an
   * unknown state — treat it like a crash instead of recycling it back to idle via release().
   */
  terminateWorker(workerId: string): void {
    const entry = this.entries.find((e) => e.instance.workerId === workerId);
    if (!entry) return;
    log.warn(`Worker ${workerId} force-terminated after exceeding its task timeout`);
    this.setCrashed(workerId);
    this.restartWorker(entry, false);
  }

  getHealth(): {
    totalWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    crashedWorkers: number;
  } {
    return {
      totalWorkers: this.entries.length,
      idleWorkers: this.entries.filter((e) => e.instance.state === 'idle').length,
      busyWorkers: this.entries.filter((e) => e.instance.state === 'busy').length,
      crashedWorkers: this.entries.filter((e) => e.instance.state === 'crashed').length,
    };
  }

  private spawnWorker(): PooledWorkerInstance {
    const workerId = crypto.randomUUID();
    let worker: Worker;
    try {
      worker = this.makeWorker();
    } catch (error) {
      // QNBS-v3 (#1272): a worker that cannot even be constructed (e.g. a CSP-blocked script) counts as a crash and starts the backoff, so on-demand starts wait.
      const delay = this.recordCrash(error instanceof Error ? error.message : String(error));
      if (!this.failure && delay > 0) this.scheduleRespawn(delay);
      throw this.failure ?? error;
    }
    const channel = new MessageChannel();

    const instance: PooledWorkerInstance = {
      workerId,
      capabilities: this.capabilities,
      state: 'idle',
      labels: this.options.labels,
      worker,
      channel,
      port: channel.port1,
    };

    // QNBS-v3: addEventListener (unlike onmessage) never dispatches until start() is called.
    //          Enabling here — once, before any task traffic — covers every later
    //          `port.addEventListener('message', ...)` in workerBus.ts::runOnPool for the
    //          lifetime of this port (including across task reuse): per the WHATWG spec,
    //          start() only flips the port's [[Enabled]] flag, it doesn't need to be
    //          re-called once a listener is attached or for subsequent tasks on the port.
    channel.port1.start();
    // QNBS-v3: Transfer port2 to worker for dedicated bidirectional channel
    worker.postMessage({ kind: 'INIT_PORT', port: channel.port2 }, [channel.port2]);

    const entry: PoolEntry = {
      instance,
      idleTimer: null,
      pingTimer: null,
      pongTimer: null,
      pongHandler: null,
    };
    this.entries.push(entry);

    // Health check
    this.startHealthCheck(entry);

    // Crash detection
    worker.addEventListener('error', (event) => {
      log.warn(`Worker ${workerId} crashed`, event.message ?? 'unknown error');
      this.setCrashed(workerId);
      this.clearHealthCheck(entry);
      this.restartWorker(entry);
    });

    return instance;
  }

  private startHealthCheck(entry: PoolEntry): void {
    entry.pingTimer = setInterval(() => {
      if (entry.instance.state === 'crashed') return;
      this.stopWaitingForPong(entry);
      const pingId = crypto.randomUUID();
      entry.instance.port.postMessage(createPingMessage(pingId));
      entry.pongTimer = setTimeout(() => {
        log.warn(`Worker ${entry.instance.workerId} pong timeout`);
        this.setCrashed(entry.instance.workerId);
        this.restartWorker(entry);
      }, WORKER_PONG_TIMEOUT_MS);

      const pongHandler = (event: MessageEvent) => {
        if (event.data?.kind !== 'PONG' || event.data?.taskId !== pingId) return;
        this.stopWaitingForPong(entry);
        // QNBS-v3 (#1272): only a pool member's pong proves its script starts; a late pong from a crashed worker resets nothing.
        if (this.entries.includes(entry)) this.markHealthy();
      };
      entry.pongHandler = pongHandler;
      entry.instance.port.addEventListener('message', pongHandler);
    }, WORKER_PING_INTERVAL_MS);
  }

  private stopWaitingForPong(entry: PoolEntry): void {
    if (entry.pongTimer) clearTimeout(entry.pongTimer);
    entry.pongTimer = null;
    if (entry.pongHandler) entry.instance.port.removeEventListener('message', entry.pongHandler);
    entry.pongHandler = null;
  }

  private clearHealthCheck(entry: PoolEntry): void {
    if (entry.pingTimer) clearInterval(entry.pingTimer);
    entry.pingTimer = null;
    this.stopWaitingForPong(entry);
  }

  // QNBS-v3 (#1272): bounded respawn; a script that never starts no longer loops as fast as the browser can fail it.
  private restartWorker(entry: PoolEntry, crashed = true): void {
    this.terminateEntry(entry);
    if (this.shutdownFlag) return;
    const delay = crashed ? this.recordCrash('worker crashed') : 0;
    if (!this.failure) this.scheduleRespawn(delay);
  }

  private scheduleRespawn(delay: number): void {
    if (delay === 0) {
      this.respawn();
      return;
    }
    // A later crash asks for a longer backoff; the replacement waits for that one, not an earlier shorter one.
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      this.respawn();
    }, delay);
  }

  /** A live member finished a task or answered a ping: the script starts, so earlier crashes and a pool failure no longer count. */
  private markHealthy(): void {
    this.consecutiveCrashes = 0;
    this.failure = null;
  }

  private respawn(): void {
    if (this.shutdownFlag || this.failure) return;
    // Another start (e.g. the replacement of a timed-out worker) may have filled the free slot meanwhile; never exceed maxWorkers.
    if (this.entries.length >= this.options.maxWorkers) {
      this.notifyAvailable();
      return;
    }
    try {
      this.spawnWorker();
    } catch {
      // QNBS-v3 (#1272): spawnWorker counted the failed start and started its backoff; after a first failure (no delay) retry at once, so a waiting task is served.
      if (!this.failure && !this.respawnTimer) this.scheduleRespawn(0);
      return;
    }
    this.notifyAvailable();
  }

  /** Counts a crash and returns the respawn delay, or fails the pool once the backoff list is used up. */
  private recordCrash(reason: string): number {
    this.consecutiveCrashes += 1;
    const delay = RESPAWN_BACKOFF_MS[this.consecutiveCrashes - 1];
    if (delay !== undefined) return delay;
    this.failure = new Error(
      `Worker pool ${this.poolId} stopped after ${this.consecutiveCrashes} consecutive worker crashes: ${reason}`,
    );
    log.error(this.failure.message);
    for (const waiter of this.acquireWaiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(this.failure);
    }
    for (const listener of this.availabilityListeners) listener();
    return 0;
  }

  private terminateEntry(entry: PoolEntry): void {
    this.clearHealthCheck(entry);
    this.clearIdleTimer(entry.instance);
    try {
      entry.instance.worker.terminate();
    } catch {
      // ignore
    }
    this.entries = this.entries.filter((e) => e !== entry);
  }

  private clearIdleTimer(instance: PooledWorkerInstance): void {
    const entry = this.entries.find((e) => e.instance.workerId === instance.workerId);
    if (entry?.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private setBusy(workerId: string): void {
    const entry = this.entries.find((e) => e.instance.workerId === workerId);
    if (entry) {
      (entry.instance as unknown as { state: string }).state = 'busy';
    }
  }

  private setIdle(workerId: string): void {
    const entry = this.entries.find((e) => e.instance.workerId === workerId);
    if (entry) {
      (entry.instance as unknown as { state: string }).state = 'idle';
      delete (entry.instance as unknown as { currentTaskId?: string }).currentTaskId;
    }
  }

  private setCrashed(workerId: string): void {
    const entry = this.entries.find((e) => e.instance.workerId === workerId);
    if (entry) {
      (entry.instance as unknown as { state: string }).state = 'crashed';
    }
  }

  private notifyAvailable(): void {
    while (this.acquireWaiters.length > 0) {
      const worker = this.tryAcquire();
      if (!worker) break;
      const waiter = this.acquireWaiters.shift();
      if (!waiter) break;
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.resolve(worker);
    }
    for (const listener of this.availabilityListeners) listener();
  }

  private abortWaiter(waiterId: symbol): void {
    const index = this.acquireWaiters.findIndex((waiter) => waiter.id === waiterId);
    if (index === -1) return;
    const [waiter] = this.acquireWaiters.splice(index, 1);
    waiter?.reject(new Error('Aborted'));
  }
}
