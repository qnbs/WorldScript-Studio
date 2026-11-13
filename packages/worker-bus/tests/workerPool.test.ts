import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WORKER_PING_INTERVAL_MS } from '../src/constants';
import { WorkerPool } from '../src/workerPool';

class MockWorker extends EventTarget {
  terminated = false;
  postMessage = vi.fn();
  terminate = vi.fn(() => {
    this.terminated = true;
  });
  addEventListener = vi.fn((type: string, handler: EventListener) => {
    super.addEventListener(type, handler);
  });
}

describe('WorkerPool', () => {
  let MockWorkerCtor: typeof Worker;
  let OriginalMessageChannel: typeof MessageChannel;

  beforeEach(() => {
    MockWorkerCtor = globalThis.Worker as unknown as typeof Worker;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    OriginalMessageChannel = globalThis.MessageChannel;
    globalThis.MessageChannel = class {
      port1 = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        start: vi.fn(),
      };
      port2 = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        start: vi.fn(),
      };
    } as unknown as typeof MessageChannel;
  });

  afterEach(() => {
    globalThis.Worker = MockWorkerCtor;
    globalThis.MessageChannel = OriginalMessageChannel;
  });

  it('spawns a worker on first acquire', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 2,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = await pool.acquire();
    expect(worker.state).toBe('busy');
    expect(worker.workerId).toBeTypeOf('string');
    await pool.terminateAll();
  });

  it('reuses idle workers', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 2,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const w1 = await pool.acquire();
    pool.release(w1);
    const w2 = await pool.acquire();
    expect(w1.workerId).toBe(w2.workerId);
    await pool.terminateAll();
  });

  it('reports health', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 2,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    await pool.acquire();
    const health = pool.getHealth();
    expect(health.totalWorkers).toBe(1);
    expect(health.busyWorkers).toBe(1);
    await pool.terminateAll();
  });

  it('throws when shutdown', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    await pool.terminateAll();
    await expect(pool.acquire()).rejects.toThrow('Pool is shutting down');
  });

  it('spawns up to maxWorkers', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 2,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    expect(w1.workerId).not.toBe(w2.workerId);
    await pool.terminateAll();
  });

  it('tryAcquire returns undefined at capacity without polling', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = pool.tryAcquire();

    expect(worker).toBeDefined();
    expect(pool.tryAcquire()).toBeUndefined();
    await pool.terminateAll();
  });

  it('notifies availability subscribers when a worker is released', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = await pool.acquire();
    const listener = vi.fn();
    const unsubscribe = pool.onAvailable(listener);

    pool.release(worker);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await pool.terminateAll();
  });

  it('waits for idle when maxWorkers reached', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const w1 = await pool.acquire();
    let acquired = false;
    const pending = pool.acquire().then((w) => {
      acquired = true;
      return w;
    });
    setTimeout(() => pool.release(w1), 10);
    await pending;
    expect(acquired).toBe(true);
    await pool.terminateAll();
  });

  it('aborts wait for idle when signal is triggered', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const w1 = await pool.acquire();
    const controller = new AbortController();
    const pending = pool.acquire(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    pool.release(w1);
    await pool.terminateAll();
  });

  it('schedules idle timeout on release', async () => {
    vi.spyOn(globalThis, 'setTimeout');
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 2,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const w1 = await pool.acquire();
    pool.release(w1);
    expect(setTimeout).toHaveBeenCalled();
    await pool.terminateAll();
    vi.restoreAllMocks();
  });

  it('marks worker as crashed on error event and restarts', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = await pool.acquire();
    const mockWorker = worker.worker as unknown as MockWorker;
    mockWorker.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    // QNBS-v3: restartWorker removes crashed entry and spawns a new one
    expect(pool.getHealth().crashedWorkers).toBe(0);
    expect(pool.getHealth().totalWorkers).toBe(1);
    await pool.terminateAll();
  });

  it('releases worker immediately during shutdown', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = await pool.acquire();
    await pool.terminateAll();
    pool.release(worker);
    expect(pool.getHealth().totalWorkers).toBe(0);
  });

  it('terminateWorker force-terminates a specific worker and respawns a replacement', async () => {
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const worker = await pool.acquire();
    const mockWorker = worker.worker as unknown as MockWorker;

    pool.terminateWorker(worker.workerId);

    expect(mockWorker.terminated).toBe(true);
    // QNBS-v3: like restartWorker() on crash — the pool respawns to stay at capacity,
    //          but the new worker must be a distinct instance, not the wedged one.
    expect(pool.getHealth().totalWorkers).toBe(1);
    expect(pool.getHealth().crashedWorkers).toBe(0);
    await pool.terminateAll();
  });

  it('terminateWorker is a no-op for an unknown workerId', async () => {
    // QNBS-v3: guards against a race where the caller holds a stale workerId (already replaced by a prior restart).
    const pool = new WorkerPool('test-pool', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/mock.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    await pool.acquire();
    expect(() => pool.terminateWorker('nonexistent-worker-id')).not.toThrow();
    expect(pool.getHealth().totalWorkers).toBe(1);
    await pool.terminateAll();
  });

  // #1272: production shipped every worker as raw TypeScript; each start failed and the pool respawned at once, forever.
  describe('worker creation and bounded respawn (#1272)', () => {
    function poolWith(createWorker: () => Worker) {
      return new WorkerPool('test-pool', ['inference.text'], {
        maxWorkers: 1,
        minWorkers: 1,
        idleTimeoutMs: 120_000,
        createWorker,
        capabilities: ['inference.text'],
        labels: {},
      });
    }
    const crash = (worker: { worker: Worker }) =>
      (worker.worker as unknown as MockWorker).dispatchEvent(
        new ErrorEvent('error', { message: 'boom' }),
      );

    it('builds workers through the createWorker factory', async () => {
      const createWorker = vi.fn(() => new MockWorker() as unknown as Worker);
      const pool = poolWith(createWorker);
      await pool.acquire();
      expect(createWorker).toHaveBeenCalledTimes(1);
      await pool.terminateAll();
    });

    it('needs a factory or a script', () => {
      expect(
        () =>
          new WorkerPool('bare', [], {
            maxWorkers: 1,
            minWorkers: 0,
            idleTimeoutMs: 1,
            capabilities: [],
            labels: {},
          }),
      ).toThrow('needs createWorker or workerScript');
    });

    it('backs off between respawns and stops after repeated crashes', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(() => new MockWorker() as unknown as Worker);
        const pool = poolWith(createWorker);
        let worker = await pool.acquire();
        crash(worker); // 1st crash: immediate respawn
        expect(createWorker).toHaveBeenCalledTimes(2);
        worker = await pool.acquire();
        crash(worker); // 2nd crash: respawn after 1 s
        expect(createWorker).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(createWorker).toHaveBeenCalledTimes(3);
        worker = await pool.acquire();
        crash(worker); // 3rd crash: respawn after 4 s
        await vi.advanceTimersByTimeAsync(4_000);
        expect(createWorker).toHaveBeenCalledTimes(4);
        worker = await pool.acquire();
        crash(worker); // 4th crash: the pool gives up
        await vi.advanceTimersByTimeAsync(60_000);
        expect(createWorker).toHaveBeenCalledTimes(4);
        await expect(pool.acquire()).rejects.toThrow('stopped after 4 consecutive worker crashes');
        expect(pool.tryAcquire()).toBeUndefined();
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a delayed respawn never exceeds maxWorkers after a task filled the slot', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(() => new MockWorker() as unknown as Worker);
        const pool = poolWith(createWorker);
        let worker = await pool.acquire();
        crash(worker); // immediate respawn
        worker = await pool.acquire();
        crash(worker); // respawn scheduled after 1 s
        const filler = pool.tryAcquire(); // a task fills the free slot on demand meanwhile
        expect(filler).toBeDefined();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(pool.getHealth().totalWorkers).toBe(1);
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a worker that finishes a task resets the crash count', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(() => new MockWorker() as unknown as Worker);
        const pool = poolWith(createWorker);
        for (let round = 0; round < 6; round += 1) {
          const worker = await pool.acquire();
          pool.release(worker); // a finished task proves the script starts
          const again = await pool.acquire();
          crash(again);
          await vi.advanceTimersByTimeAsync(5_000);
        }
        await expect(pool.acquire()).resolves.toBeDefined();
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a worker that cannot even be constructed fails the pool instead of looping', async () => {
      const createWorker = vi.fn(() => {
        throw new DOMException('Refused by the Content Security Policy', 'SecurityError');
      });
      const pool = poolWith(createWorker);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(() => pool.tryAcquire()).toThrow('Content Security Policy');
      }
      // The fourth failed construction fails the pool; after that nothing is constructed any more.
      expect(() => pool.tryAcquire()).toThrow('stopped after 4 consecutive worker crashes');
      expect(pool.tryAcquire()).toBeUndefined();
      await expect(pool.acquire()).rejects.toThrow('stopped after 4 consecutive worker crashes');
      expect(createWorker).toHaveBeenCalledTimes(4);
      await pool.terminateAll();
    });

    const newMockWorker = () => new MockWorker() as unknown as Worker;
    const pong = (worker: { port: MessagePort }) => {
      const port = worker.port as unknown as { postMessage: Mock; addEventListener: Mock };
      const ping = port.postMessage.mock.calls.at(-1)?.[0] as { kind: string; taskId: string };
      expect(ping.kind).toBe('PING');
      const onMessage = port.addEventListener.mock.calls.find(([type]) => type === 'message')?.[1];
      (onMessage as (event: { data: unknown }) => void)({
        data: { kind: 'PONG', taskId: ping.taskId },
      });
    };

    it('refuses an already aborted wait at once while every worker is busy', async () => {
      const pool = poolWith(newMockWorker);
      const busy = await pool.acquire();
      const controller = new AbortController();
      controller.abort();
      await expect(pool.acquire(controller.signal)).rejects.toThrow('Aborted');
      pool.release(busy);
      // Nothing was left waiting: the released worker stays idle for the next caller.
      expect(pool.tryAcquire()?.workerId).toBe(busy.workerId);
      await pool.terminateAll();
    });

    it('shutting down cancels a pending respawn', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(newMockWorker);
        const pool = poolWith(createWorker);
        crash(await pool.acquire()); // 1st crash: immediate respawn
        crash(await pool.acquire()); // 2nd crash: respawn due in 1 s
        await pool.terminateAll();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(createWorker).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a crash reported after shutdown respawns nothing', async () => {
      const createWorker = vi.fn(newMockWorker);
      const pool = poolWith(createWorker);
      const worker = await pool.acquire();
      await pool.terminateAll();
      crash(worker);
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(pool.getHealth().totalWorkers).toBe(0);
    });

    it('a worker that answers a health-check ping resets the crash count', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(newMockWorker);
        const pool = poolWith(createWorker);
        crash(await pool.acquire()); // 1st crash: immediate respawn
        crash(await pool.acquire()); // 2nd crash: respawn after 1 s
        await vi.advanceTimersByTimeAsync(1_000);
        const worker = await pool.acquire();
        await vi.advanceTimersByTimeAsync(WORKER_PING_INTERVAL_MS);
        pong(worker); // the script starts after all
        crash(worker); // a first crash again: immediate respawn instead of a 4 s backoff
        expect(createWorker).toHaveBeenCalledTimes(4);
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a late pong from a worker that already crashed resets nothing', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(newMockWorker);
        const pool = poolWith(createWorker);
        crash(await pool.acquire()); // 1st crash: immediate respawn
        const pinged = await pool.acquire();
        await vi.advanceTimersByTimeAsync(WORKER_PING_INTERVAL_MS);
        crash(pinged); // 2nd crash: respawn after 1 s
        pong(pinged); // its pong was still queued when it crashed
        const port = pinged.port as unknown as { removeEventListener: Mock };
        expect(port.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
        await vi.advanceTimersByTimeAsync(1_000);
        crash(await pool.acquire()); // 3rd crash: still a 4 s backoff, not an immediate respawn
        expect(createWorker).toHaveBeenCalledTimes(3);
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a respawn that cannot construct its worker retries after the backoff and serves the waiting task', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi
          .fn(newMockWorker)
          .mockImplementationOnce(newMockWorker)
          .mockImplementationOnce(() => {
            // A non-Error rejection (some engines throw plain values from a blocked worker script).
            throw 'blocked by policy';
          });
        const pool = poolWith(createWorker);
        const busy = await pool.acquire();
        const waiting = pool.acquire();
        crash(busy); // immediate respawn, whose construction fails
        expect(createWorker).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(createWorker).toHaveBeenCalledTimes(3);
        await expect(waiting).resolves.toMatchObject({ state: 'busy' });
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a pool that gives up rejects the tasks still waiting for a worker', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi
          .fn((): Worker => {
            throw new Error('blocked by policy');
          })
          .mockImplementationOnce(newMockWorker);
        const pool = poolWith(createWorker);
        const busy = await pool.acquire();
        const waiting = pool.acquire(new AbortController().signal);
        const outcome = waiting.catch((error: Error) => error.message);
        crash(busy); // the respawn and both retries fail to construct the worker
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await outcome).toBe(
          'Worker pool test-pool stopped after 4 consecutive worker crashes: blocked by policy',
        );
        await vi.advanceTimersByTimeAsync(60_000);
        expect(createWorker).toHaveBeenCalledTimes(4);
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a respawn that falls due after the pool gave up starts nothing', async () => {
      vi.useFakeTimers();
      try {
        const createWorker = vi.fn(newMockWorker);
        const pool = poolWith(createWorker);
        crash(await pool.acquire()); // 1st crash: immediate respawn
        crash(await pool.acquire()); // 2nd crash: respawn due in 1 s
        crash(await pool.acquire()); // tasks start workers on demand meanwhile; 3rd crash keeps that respawn
        crash(await pool.acquire()); // 4th crash: the pool gives up
        await vi.advanceTimersByTimeAsync(1_000);
        expect(createWorker).toHaveBeenCalledTimes(4);
        await expect(pool.acquire()).rejects.toThrow('stopped after 4 consecutive worker crashes');
        await pool.terminateAll();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
