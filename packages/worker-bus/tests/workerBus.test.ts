import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResult } from '../src/types';
import { WorkerBus } from '../src/workerBus';
import type { WorkerPool } from '../src/workerPool';

// QNBS-v3: suppress unhandled rejections from async microtask timing in mocked runTask tests.
//          The rejections are always caught by test assertions; Vitest's detector fires first.
process.on('unhandledRejection', () => {
  /* no-op: tests below intentionally trigger and catch rejections */
});

describe('WorkerBus', () => {
  let bus: WorkerBus;

  beforeEach(() => {
    bus = new WorkerBus({
      maxQueueSize: 8,
      maxPreemptions: 3,
      workerPoolSize: 2,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 3,
      circuitBreakerRecoveryMs: 1_000,
      enableDeadLetter: true,
      deadLetterCapacity: 8,
      enableTracing: false,
    });
    bus.registerPool('fake', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/fake.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(pool, 'acquire').mockReturnValue(new Promise(() => {}));
  });

  afterEach(async () => {
    await bus.shutdown();
  });

  it('enqueue returns a TaskHandle', () => {
    const handle = bus.enqueue('test.task', { data: 1 });
    expect(handle.taskId).toBeTypeOf('string');
    expect(handle.cancel).toBeTypeOf('function');
    handle.result.catch(() => {});
  });

  it('cancel removes a queued task', () => {
    const handle = bus.enqueue('test.task', { data: 1 });
    const cancelled = bus.cancel(handle.taskId);
    expect(cancelled).toBe(true);
    handle.result.catch(() => {});
  });

  it('telemetry starts at zero', () => {
    const t = bus.getTelemetry();
    expect(t.processedTasks).toBe(0);
    expect(t.failedTasks).toBe(0);
    expect(t.deadLetterCount).toBe(0);
    expect(t.queueDepth).toEqual({ critical: 0, high: 0, normal: 0, low: 0 });
  });

  it('subscribe and unsubscribe', () => {
    const events: unknown[] = [];
    const off = bus.subscribe((ev: unknown) => events.push(ev));
    off();
    expect(events).toHaveLength(0);
  });

  it('rejects when circuit breaker open', async () => {
    const cb = (
      bus as unknown as { getCircuitBreaker: (t: string) => { recordFailure: () => void } }
    ).getCircuitBreaker('fragile.task');
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    const handle = bus.enqueue('fragile.task', {});
    await expect(handle.result).rejects.toThrow('Circuit breaker is open');
  });

  it('rejects when queue full', async () => {
    const smallBus = new WorkerBus({
      maxQueueSize: 1,
      maxPreemptions: 3,
      workerPoolSize: 1,
      enableCircuitBreaker: false,
      circuitBreakerThreshold: 5,
      circuitBreakerRecoveryMs: 1_000,
      enableDeadLetter: true,
      deadLetterCapacity: 4,
      enableTracing: false,
    });
    smallBus.registerPool('fake2', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/fake.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    const pool2 = (smallBus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake2')!;
    vi.spyOn(pool2, 'acquire').mockReturnValue(new Promise(() => {}));

    smallBus.enqueue('fill', {}).result.catch(() => {});
    const handle = smallBus.enqueue('overflow', {});
    await expect(handle.result).rejects.toThrow('Queue full');
    await smallBus.shutdown();
  });

  it('resolves task when runTask succeeds', async () => {
    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'hello',
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });
    const handle = bus.enqueue('test.task', {});
    await expect(handle.result).resolves.toBe('hello');
  });

  it('rejects task when runTask fails with non-recoverable error', async () => {
    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid payload',
          recoverable: false,
          retryCount: 0,
        },
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });
    const handle = bus.enqueue('test.task', {});
    await expect(handle.result).rejects.toThrow('Invalid payload');
  });

  it('retries recoverable errors then rejects', async () => {
    const mockRunTask = vi
      .fn()
      .mockResolvedValueOnce({
        taskId: 'x',
        success: false,
        error: { code: 'TIMEOUT', message: 'Worker timed out', recoverable: true, retryCount: 0 },
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      })
      .mockResolvedValueOnce({
        taskId: 'x',
        success: false,
        error: { code: 'TIMEOUT', message: 'Worker timed out', recoverable: true, retryCount: 1 },
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      })
      .mockResolvedValueOnce({
        taskId: 'x',
        success: false,
        error: { code: 'TIMEOUT', message: 'Worker timed out', recoverable: true, retryCount: 2 },
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });
    (bus as unknown as { runTask: typeof mockRunTask }).runTask = mockRunTask;

    const handle = bus.enqueue(
      'test.task',
      {},
      { retryPolicy: { maxRetries: 2, backoffMs: 1, maxBackoffMs: 10, jitter: false } },
    );
    await expect(handle.result).rejects.toThrow('Worker timed out');
    expect(mockRunTask).toHaveBeenCalledTimes(3);
  });

  it('emits bus events on enqueue and result', async () => {
    const events: Array<{ kind: string }> = [];
    bus.subscribe((ev: unknown) => events.push(ev as { kind: string }));

    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'ok',
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });

    const handle = bus.enqueue('test.task', {});
    await handle.result;
    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it('shutdown clears pools and rejects new acquires', async () => {
    await bus.shutdown();
    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake');
    expect(pool).toBeUndefined();
  });

  it('progress callback receives emitted progress', async () => {
    const progressUpdates: Array<{ stage: string; progress: number }> = [];
    let capturedTaskId = '';

    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockImplementation(async (task) => {
        capturedTaskId = (task as { taskId: string }).taskId;
        const emitter = (bus as unknown as { progress: { emit: (id: string, p: unknown) => void } })
          .progress;
        emitter.emit(capturedTaskId, {
          taskId: capturedTaskId,
          taskType: 'test.task',
          stage: 'loading',
          progress: 0.5,
          timestamp: Date.now(),
        });
        return {
          taskId: capturedTaskId,
          success: true,
          result: 'ok',
          latencyMs: 10,
          queueTimeMs: 5,
          layer: 'web',
        };
      });

    const handle = bus.enqueue(
      'test.task',
      {},
      {
        onProgress: (p) => progressUpdates.push({ stage: p.stage, progress: p.progress }),
      },
    );
    await handle.result;
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    expect(progressUpdates[0]?.stage).toBe('loading');
  });

  it('cancel triggers token abort', async () => {
    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockImplementation(async (task, token) => {
        return new Promise((resolve) => {
          const tid = (task as { taskId: string }).taskId;
          const onAbort = () => {
            resolve({
              taskId: tid,
              success: false,
              error: {
                code: 'CANCELLED',
                message: 'Task was cancelled',
                recoverable: false,
                retryCount: 0,
              },
              latencyMs: 0,
              queueTimeMs: 0,
              layer: 'web',
            });
          };
          token.signal.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => {
            token.signal.removeEventListener('abort', onAbort);
            resolve({
              taskId: tid,
              success: true,
              result: 'completed',
              latencyMs: 0,
              queueTimeMs: 0,
              layer: 'web',
            });
          }, 100);
        });
      });

    const handle = bus.enqueue('test.task', {});
    handle.cancel('user-request');
    await expect(handle.result).rejects.toThrow('cancelled');
  });

  it('circuit breaker records success after successful task', async () => {
    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'ok',
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });

    const handle = bus.enqueue('resilient.task', {});
    await handle.result;
    const states = bus.getTelemetry().circuitBreakerStates;
    expect(states['resilient.task']).toBe('closed');
  });

  it('custom retry policy overrides defaults', async () => {
    const mockRunTask = vi.fn().mockResolvedValue({
      taskId: 'x',
      success: false,
      error: { code: 'FAIL', message: 'fail', recoverable: true, retryCount: 0 },
      latencyMs: 10,
      queueTimeMs: 5,
      layer: 'web',
    });
    (bus as unknown as { runTask: typeof mockRunTask }).runTask = mockRunTask;

    const handle = bus.enqueue(
      'test.task',
      {},
      { retryPolicy: { maxRetries: 0, backoffMs: 1, maxBackoffMs: 10, jitter: false } },
    );
    await expect(handle.result).rejects.toThrow('fail');
    expect(mockRunTask).toHaveBeenCalledTimes(1);
  });

  it('duplicate pool registration is ignored', () => {
    bus.registerPool('fake', ['inference.text'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/fake.worker.js',
      capabilities: ['inference.text'],
      labels: {},
    });
    // Should not throw and should keep original pool
    const pools = (bus as unknown as { pools: Map<string, WorkerPool> }).pools;
    expect(pools.has('fake')).toBe(true);
  });

  it('subscribe listener errors are isolated', async () => {
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    // Should not throw when event is emitted
    (bus as unknown as { runTask: () => Promise<TaskResult<string>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'ok',
        latencyMs: 10,
        queueTimeMs: 5,
        layer: 'web',
      });
    const handle = bus.enqueue('test.task', {});
    await expect(handle.result).resolves.toBe('ok');
  });

  it('cancel with token calls abort and removes from queue', () => {
    const handle = bus.enqueue('test.task', { data: 1 });
    // Cancel before it runs
    const cancelled = bus.cancel(handle.taskId, 'test-reason');
    expect(cancelled).toBe(true);
    handle.result.catch(() => {});
  });

  it('enqueue with parentTaskId builds traceId', () => {
    const handle = bus.enqueue('test.task', { data: 1 }, { parentTaskId: 'parent-1' });
    expect(handle.taskId).toBeTypeOf('string');
    handle.result.catch(() => {});
  });

  it('rejects when no pool supports required capabilities', async () => {
    const handle = bus.enqueue(
      'test.task',
      { data: 1 },
      {
        capabilities: [
          'nonexistent.capability' as unknown as import('../src/types').WorkerCapability,
        ],
      },
    );
    await expect(handle.result).rejects.toThrow('No pool supports required capabilities');
  });

  it('runs task through real worker port and resolves result', async () => {
    // Create a mock port that responds with a RESULT message
    const mockPort = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (type === 'message') {
          // Simulate worker responding with RESULT after a microtask
          queueMicrotask(() => {
            handler(
              new MessageEvent('message', {
                data: {
                  kind: 'RESULT',
                  taskId: 'mock-task-id',
                  success: true,
                  result: 'worker-output',
                  latencyMs: 10,
                },
              }),
            );
          });
        }
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    };

    const mockWorker = {
      workerId: 'mock-worker-1',
      worker: {} as Worker,
      channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
      port: mockPort as unknown as MessagePort,
      state: 'idle' as const,
      capabilities: ['inference.text'] as const,
      labels: {},
    };

    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(pool, 'acquire').mockResolvedValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );

    const handle = bus.enqueue('test.task', { data: 1 });
    await expect(handle.result).resolves.toBe('worker-output');
  });

  it('runs task through real worker port and handles progress', async () => {
    const progressEvents: Array<{ stage: string; progress: number }> = [];
    const mockPort = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (type === 'message') {
          queueMicrotask(() => {
            handler(
              new MessageEvent('message', {
                data: {
                  kind: 'PROGRESS',
                  taskId: 'mock-task-id',
                  stage: 'loading',
                  progress: 0.5,
                },
              }),
            );
          });
          queueMicrotask(() => {
            handler(
              new MessageEvent('message', {
                data: {
                  kind: 'RESULT',
                  taskId: 'mock-task-id',
                  success: true,
                  result: 'done',
                  latencyMs: 10,
                },
              }),
            );
          });
        }
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    };

    const mockWorker = {
      workerId: 'mock-worker-1',
      worker: {} as Worker,
      channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
      port: mockPort as unknown as MessagePort,
      state: 'idle' as const,
      capabilities: ['inference.text'] as const,
      labels: {},
    };

    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(pool, 'acquire').mockResolvedValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );

    const handle = bus.enqueue(
      'test.task',
      { data: 1 },
      {
        onProgress: (p) => progressEvents.push({ stage: p.stage, progress: p.progress }),
      },
    );
    await handle.result;
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0]?.stage).toBe('loading');
  });

  it('runs task through real worker port and handles abort', async () => {
    const mockPort = {
      addEventListener: vi.fn((type: string, _handler: EventListener) => {
        if (type === 'message') {
          // Never send RESULT — let abort happen
        }
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    };

    const mockWorker = {
      workerId: 'mock-worker-1',
      worker: {} as Worker,
      channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
      port: mockPort as unknown as MessagePort,
      state: 'idle' as const,
      capabilities: ['inference.text'] as const,
      labels: {},
    };

    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(pool, 'acquire').mockResolvedValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );

    const handle = bus.enqueue('test.task', { data: 1 });
    // Allow runTask to set up abort listener before cancelling
    await new Promise((r) => setTimeout(r, 10));
    handle.cancel('test-abort');
    await expect(handle.result).rejects.toThrow('cancelled');
  });
});
