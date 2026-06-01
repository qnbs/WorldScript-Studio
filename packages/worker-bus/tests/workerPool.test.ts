import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
