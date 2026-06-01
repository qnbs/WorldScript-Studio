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

export class WorkerPool {
  private entries: PoolEntry[] = [];
  private readonly workerScript: string;
  private shutdownFlag = false;

  constructor(
    public readonly poolId: string,
    public readonly capabilities: readonly WorkerCapability[],
    public readonly options: WorkerPoolOptions,
  ) {
    this.workerScript = options.workerScript;
  }

  async acquire(signal?: AbortSignal): Promise<PooledWorkerInstance> {
    if (this.shutdownFlag) throw new Error('Pool is shutting down');

    // Try to find idle worker
    const idle = this.entries.find((e) => e.instance.state === 'idle');
    if (idle) {
      this.setBusy(idle.instance.workerId);
      this.clearIdleTimer(idle);
      return idle.instance;
    }

    // Spawn new worker if under max
    if (this.entries.length < this.options.maxWorkers) {
      const worker = this.spawnWorker();
      this.setBusy(worker.workerId);
      return worker;
    }

    // Wait for a worker to become idle
    return this.waitForIdle(signal);
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
  }

  async terminateAll(): Promise<void> {
    this.shutdownFlag = true;
    for (const entry of this.entries) {
      this.terminateEntry(entry);
    }
    this.entries = [];
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

  private waitForIdle(signal?: AbortSignal): Promise<PooledWorkerInstance> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const idle = this.entries.find((e) => e.instance.state === 'idle');
        if (idle) {
          cleanup();
          this.setBusy(idle.instance.workerId);
          resolve(idle.instance);
          return;
        }
        if (this.shutdownFlag) {
          cleanup();
          reject(new Error('Pool is shutting down'));
          return;
        }
        requestAnimationFrame(check);
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('Aborted'));
      };

      signal?.addEventListener('abort', onAbort);
      check();
    });
  }
}
