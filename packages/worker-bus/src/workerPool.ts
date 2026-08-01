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
}

interface AcquireWaiter {
  readonly resolve: (worker: PooledWorkerInstance) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

export class WorkerPool {
  private entries: PoolEntry[] = [];
  private readonly workerScript: string;
  private shutdownFlag = false;
  private readonly availabilityListeners = new Set<() => void>();
  private readonly acquireWaiters: AcquireWaiter[] = [];

  constructor(
    public readonly poolId: string,
    public readonly capabilities: readonly WorkerCapability[],
    public readonly options: WorkerPoolOptions,
  ) {
    this.workerScript = options.workerScript;
  }

  async acquire(signal?: AbortSignal): Promise<PooledWorkerInstance> {
    const worker = this.tryAcquire();
    if (worker) return worker;
    if (this.shutdownFlag) throw new Error('Pool is shutting down');
    if (signal?.aborted) throw new Error('Aborted');

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.removeWaiter(waiter);
        reject(new Error('Aborted'));
      };
      const waiter: AcquireWaiter = { resolve, reject, signal, onAbort };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.acquireWaiters.push(waiter);
    });
  }

  tryAcquire(): PooledWorkerInstance | undefined {
    if (this.shutdownFlag) return undefined;
    const idle = this.entries.find((entry) => entry.instance.state === 'idle');
    if (idle) {
      this.setBusy(idle.instance.workerId);
      this.clearIdleTimer(idle.instance);
      return idle.instance;
    }
    if (this.entries.length >= this.options.maxWorkers) return undefined;
    const worker = this.spawnWorker();
    this.setBusy(worker.workerId);
    return worker;
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
    this.restartWorker(entry);
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
    const worker = new Worker(new URL(this.workerScript, import.meta.url), {
      type: 'module',
    });
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

    const entry: PoolEntry = { instance, idleTimer: null, pingTimer: null, pongTimer: null };
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
      const pingId = crypto.randomUUID();
      entry.instance.port.postMessage(createPingMessage(pingId));
      entry.pongTimer = setTimeout(() => {
        log.warn(`Worker ${entry.instance.workerId} pong timeout`);
        this.setCrashed(entry.instance.workerId);
        this.restartWorker(entry);
      }, WORKER_PONG_TIMEOUT_MS);

      const pongHandler = (event: MessageEvent) => {
        if (event.data?.kind === 'PONG' && event.data?.taskId === pingId) {
          clearTimeout(entry.pongTimer ?? undefined);
          entry.instance.port.removeEventListener('message', pongHandler);
        }
      };
      entry.instance.port.addEventListener('message', pongHandler);
    }, WORKER_PING_INTERVAL_MS);
  }

  private clearHealthCheck(entry: PoolEntry): void {
    if (entry.pingTimer) clearInterval(entry.pingTimer);
    if (entry.pongTimer) clearTimeout(entry.pongTimer);
    entry.pingTimer = null;
    entry.pongTimer = null;
  }

  private restartWorker(entry: PoolEntry): void {
    this.terminateEntry(entry);
    if (!this.shutdownFlag) {
      this.spawnWorker();
      this.notifyAvailable();
    }
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

  private removeWaiter(waiter: AcquireWaiter): void {
    const index = this.acquireWaiters.indexOf(waiter);
    if (index !== -1) this.acquireWaiters.splice(index, 1);
  }
}
