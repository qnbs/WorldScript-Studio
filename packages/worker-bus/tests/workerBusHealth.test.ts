import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerBus } from '../src/workerBus';
import type { PooledWorkerInstance, WorkerPool } from '../src/workerPool';

// #1278: a worker counts as healthy only when it answers a task; the bus tells the pool when that happens.
describe('WorkerBus worker health', () => {
  let bus: WorkerBus;
  let pool: WorkerPool;

  /** A pooled worker on a fake port; `answer` sends one RESULT for the task the bus posts. */
  function fakeWorker(workerId: string, answer: boolean) {
    const port = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (type !== 'message' || !answer) return;
        queueMicrotask(() => {
          const posted = port.postMessage.mock.calls.at(-1)?.[0] as { taskId?: string } | undefined;
          handler(
            new MessageEvent('message', {
              data: {
                kind: 'RESULT',
                taskId: posted?.taskId,
                success: true,
                result: 'ok',
                latencyMs: 1,
              },
            }),
          );
        });
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    };
    const worker = {
      workerId,
      worker: {} as Worker,
      channel: { port1: port, port2: port } as unknown as MessageChannel,
      port: port as unknown as MessagePort,
      state: 'idle' as const,
      capabilities: ['inference.text'] as const,
      labels: {},
    };
    vi.spyOn(pool, 'tryAcquire').mockReturnValue(worker as unknown as PooledWorkerInstance);
    return port;
  }

  beforeEach(() => {
    bus = new WorkerBus({
      maxQueueSize: 8,
      maxPreemptions: 3,
      workerPoolSize: 1,
      enableCircuitBreaker: false,
      circuitBreakerThreshold: 3,
      circuitBreakerRecoveryMs: 1_000,
      enableDeadLetter: false,
      deadLetterCapacity: 8,
      enableTracing: false,
    });
    bus.registerPool('fake', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 0,
      idleTimeoutMs: 120_000,
      workerScript: '/fake.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
  });

  afterEach(async () => {
    await bus.shutdown();
  });

  it('marks the worker healthy when it answers with a RESULT', async () => {
    fakeWorker('answering-worker', true);
    const markWorkerHealthy = vi.spyOn(pool, 'markWorkerHealthy');

    const handle = bus.enqueue('test.task', { data: 1 });

    await expect(handle.result).resolves.toBe('ok');
    expect(markWorkerHealthy).toHaveBeenCalledWith('answering-worker');
  });

  it('does not mark a worker healthy when its task is cancelled before it answers', async () => {
    const port = fakeWorker('silent-worker', false);
    const release = vi.spyOn(pool, 'release');
    const markWorkerHealthy = vi.spyOn(pool, 'markWorkerHealthy');

    const handle = bus.enqueue('test.task', { data: 1 });
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    handle.cancel('user-request');
    await handle.result.catch(() => undefined);

    await vi.waitFor(() => expect(release).toHaveBeenCalled());
    expect(markWorkerHealthy).not.toHaveBeenCalled();
  });
});
