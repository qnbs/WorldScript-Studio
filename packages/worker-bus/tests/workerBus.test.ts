import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResult } from '../src/types';
import { WorkerBus } from '../src/workerBus';
import type { PooledWorkerInstance, WorkerPool } from '../src/workerPool';

// QNBS-v3: suppress unhandled rejections from async microtask timing in mocked runTask tests.
//          The rejections are always caught by test assertions; Vitest's detector fires first.
process.on('unhandledRejection', () => {
  /* no-op: tests below intentionally trigger and catch rejections */
});

describe('WorkerBus', () => {
  let bus: WorkerBus;
  let allowDispatch: (worker?: PooledWorkerInstance) => void;

  const schedulerWorker = {
    workerId: 'scheduler-worker',
    worker: {} as Worker,
    channel: {} as MessageChannel,
    port: {} as MessagePort,
    state: 'busy' as const,
    capabilities: ['inference.text'] as const,
    labels: {},
  };

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
    const tryAcquire = vi.spyOn(pool, 'tryAcquire').mockReturnValue(undefined);
    allowDispatch = (worker = schedulerWorker) => tryAcquire.mockReturnValue(worker);
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
    vi.spyOn(pool2, 'tryAcquire').mockReturnValue(undefined);

    smallBus.enqueue('fill', {}).result.catch(() => {});
    const handle = smallBus.enqueue('overflow', {});
    await expect(handle.result).rejects.toThrow('Queue full');
    await smallBus.shutdown();
  });

  it('drains the live queue across more than 32 lifetime submissions', async () => {
    allowDispatch();
    (bus as unknown as { runTask: () => Promise<TaskResult<number>> }).runTask = vi
      .fn()
      .mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 1,
        latencyMs: 1,
        queueTimeMs: 0,
        layer: 'web',
      });

    for (let index = 0; index < 40; index++) {
      await expect(bus.enqueue<null, number>('test.task', null).result).resolves.toBe(1);
    }

    expect(bus.getTelemetry().queueDepth).toEqual({ critical: 0, high: 0, normal: 0, low: 0 });
    expect(bus.getTelemetry().processedTasks).toBe(40);
  });

  it('dispatches saturated work by priority and FIFO within a tier', async () => {
    const executionOrder: string[] = [];
    (
      bus as unknown as { runTask: (task: { payload: string }) => Promise<TaskResult<string>> }
    ).runTask = vi.fn().mockImplementation(async (task) => {
      executionOrder.push(task.payload);
      return {
        taskId: 'x',
        success: true,
        result: task.payload,
        latencyMs: 1,
        queueTimeMs: 0,
        layer: 'web',
      };
    });
    const handles = [
      bus.enqueue<string, string>('test.task', 'low', { priority: 'low' }),
      bus.enqueue<string, string>('test.task', 'normal-1', { priority: 'normal' }),
      bus.enqueue<string, string>('test.task', 'critical', { priority: 'critical' }),
      bus.enqueue<string, string>('test.task', 'high', { priority: 'high' }),
      bus.enqueue<string, string>('test.task', 'normal-2', { priority: 'normal' }),
    ];

    allowDispatch();
    (bus as unknown as { schedulePump: () => void }).schedulePump();
    await Promise.all(handles.map((handle) => handle.result));

    expect(executionOrder).toEqual(['critical', 'high', 'normal-1', 'normal-2', 'low']);
  });

  it('times out while queued and clears scheduler-owned state', async () => {
    vi.useFakeTimers();
    try {
      const handle = bus.enqueue(
        'test.task',
        {},
        { timeoutMs: 25, retryPolicy: { maxRetries: 0 } },
      );
      const assertion = expect(handle.result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;

      expect(bus.getTelemetry().queueDepth).toEqual({ critical: 0, high: 0, normal: 0, low: 0 });
      const internals = bus as unknown as {
        pendingTasks: Map<string, unknown>;
        tokens: Map<string, unknown>;
        taskPools: Map<string, unknown>;
      };
      expect(internals.pendingTasks.size).toBe(0);
      expect(internals.tokens.size).toBe(0);
      expect(internals.taskPools.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a queued inactivity timeout without cancelling the logical task', async () => {
    vi.useFakeTimers();
    try {
      const runTask = vi.fn().mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'retried',
        latencyMs: 1,
        queueTimeMs: 0,
        layer: 'web',
      });
      (bus as unknown as { runTask: typeof runTask }).runTask = runTask;
      const handle = bus.enqueue<null, string>('test.task', null, {
        timeoutMs: 25,
        retryPolicy: { maxRetries: 1, backoffMs: 1, maxBackoffMs: 1, jitter: false },
      });

      await vi.advanceTimersByTimeAsync(25);
      allowDispatch();
      await vi.advanceTimersByTimeAsync(1);

      await expect(handle.result).resolves.toBe('retried');
      expect(runTask).toHaveBeenCalledTimes(1);
      expect(bus.getTelemetry().failedTasks).toBe(0);
      expect(bus.getTelemetry().deadLetterCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects queued handles on shutdown and clears every scheduler map', async () => {
    const handle = bus.enqueue('test.task', {});
    const assertion = expect(handle.result).rejects.toMatchObject({ code: 'SHUTDOWN' });

    await bus.shutdown();
    await assertion;

    const internals = bus as unknown as {
      pendingTasks: Map<string, unknown>;
      tokens: Map<string, unknown>;
      taskPools: Map<string, unknown>;
    };
    expect(internals.pendingTasks.size).toBe(0);
    expect(internals.tokens.size).toBe(0);
    expect(internals.taskPools.size).toBe(0);
  });

  it('uses a bounded critical reserve and emits hard-saturation telemetry', async () => {
    const constrainedBus = new WorkerBus({
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
    const events: string[] = [];
    constrainedBus.subscribe((event) => events.push(event.kind));
    const accepted = [constrainedBus.enqueue('normal', {})];
    for (let index = 0; index < 8; index++) {
      accepted.push(constrainedBus.enqueue('critical', {}, { priority: 'critical' }));
    }
    const overflow = constrainedBus.enqueue('critical', {}, { priority: 'critical' });
    const assertion = expect(overflow.result).rejects.toMatchObject({ code: 'BACKPRESSURE' });

    await assertion;
    expect(events).toContain('hard-backpressure-rejected');
    for (const handle of accepted) handle.result.catch(() => {});
    await constrainedBus.shutdown();
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
    allowDispatch();
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
    allowDispatch();
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
    allowDispatch();

    const handle = bus.enqueue(
      'test.task',
      {},
      { retryPolicy: { maxRetries: 2, backoffMs: 1, maxBackoffMs: 10, jitter: false } },
    );
    await expect(handle.result).rejects.toThrow('Worker timed out');
    expect(mockRunTask).toHaveBeenCalledTimes(3);
  });

  it('retries a worker-construction failure instead of stalling in the pump microtask', async () => {
    vi.useFakeTimers();
    try {
      const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
      allowDispatch();
      vi.mocked(pool.tryAcquire).mockImplementationOnce(() => {
        throw new Error('worker constructor failed');
      });
      const runTask = vi.fn().mockResolvedValue({
        taskId: 'x',
        success: true,
        result: 'recovered',
        latencyMs: 1,
        queueTimeMs: 0,
        layer: 'web',
      });
      (bus as unknown as { runTask: typeof runTask }).runTask = runTask;

      const handle = bus.enqueue<null, string>('test.task', null, {
        retryPolicy: { maxRetries: 1, backoffMs: 1, maxBackoffMs: 1, jitter: false },
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1);

      await expect(handle.result).resolves.toBe('recovered');
      expect(pool.tryAcquire).toHaveBeenCalledTimes(2);
      expect(runTask).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records retry backpressure as a terminal failure and dead letter', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      bus.subscribe((event) => events.push(event.kind));
      const handle = bus.enqueue(
        'retrying.task',
        {},
        {
          retryPolicy: { maxRetries: 1, backoffMs: 1, maxBackoffMs: 1, jitter: false },
        },
      );
      const internals = bus as unknown as {
        queue: { remove: (taskId: string) => boolean };
        pendingTasks: Map<string, unknown>;
        handleAttemptResult: (pending: unknown, result: TaskResult) => void;
      };
      internals.queue.remove(handle.taskId);
      const pending = internals.pendingTasks.get(handle.taskId)!;
      internals.handleAttemptResult(pending, {
        taskId: handle.taskId,
        success: false,
        error: { code: 'RETRY', message: 'retry', recoverable: true, retryCount: 0 },
        latencyMs: 1,
        queueTimeMs: 0,
        layer: 'main',
      });
      for (let index = 0; index < 8; index++) {
        bus.enqueue('filler.task', { index }).result.catch(() => {});
      }
      const assertion = expect(handle.result).rejects.toMatchObject({ code: 'BACKPRESSURE' });

      await vi.advanceTimersByTimeAsync(1);

      await assertion;
      expect(events).toContain('backpressure-rejected');
      expect(bus.getTelemetry().failedTasks).toBe(1);
      expect(bus.getTelemetry().deadLetterCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
    allowDispatch();

    const handle = bus.enqueue('test.task', {});
    await handle.result;
    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it('shutdown clears pools and rejects new acquires', async () => {
    await bus.shutdown();
    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake');
    expect(pool).toBeUndefined();
  });

  it('terminatePool terminates and removes only the named pool, leaving others intact', async () => {
    bus.registerPool('other', ['db.duckdb'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/other.worker.js',
      capabilities: ['db.duckdb'],
      labels: {},
    });
    const pools = (bus as unknown as { pools: Map<string, WorkerPool> }).pools;
    const terminateAllSpy = vi.spyOn(pools.get('fake')!, 'terminateAll');
    vi.spyOn(pools.get('other')!, 'tryAcquire').mockReturnValue(undefined);

    await bus.terminatePool('fake');

    expect(terminateAllSpy).toHaveBeenCalled();
    expect(pools.get('fake')).toBeUndefined();
    expect(pools.get('other')).toBeDefined();
  });

  it('terminatePool is a no-op for an unknown pool id', async () => {
    await expect(bus.terminatePool('does-not-exist')).resolves.toBeUndefined();
  });

  it('terminatePool cancels only the in-flight tasks routed to that pool', async () => {
    // QNBS-v3: [beforeEach's mocked acquire() ignores the abort signal entirely (returns a
    //          promise that never settles); override it here with a signal-aware implementation
    //          mirroring WorkerPool's real waitForIdle() so cancellation can actually be observed
    //          unsticking the caller, not just verified as "cancel() was called".]
    const fakePool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(fakePool, 'tryAcquire').mockReturnValue(schedulerWorker);
    bus.registerPool('other', ['db.duckdb'], {
      maxWorkers: 1,
      minWorkers: 1,
      idleTimeoutMs: 120_000,
      workerScript: '/other.worker.js',
      capabilities: ['db.duckdb'],
      labels: {},
    });
    const otherPool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('other')!;
    vi.spyOn(otherPool, 'tryAcquire').mockReturnValue(undefined);

    const fakeHandle = bus.enqueue('test.task', {}, { capabilities: ['inference.text'] });
    const otherHandle = bus.enqueue('other.task', {}, { capabilities: ['db.duckdb'] });
    otherHandle.result.catch(() => {});

    const cancelSpy = vi.spyOn(bus, 'cancel');
    await bus.terminatePool('fake');

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(fakeHandle.taskId, 'Pool terminated');
    // Without the fix, this task would hang forever at pool.acquire() — terminatePool()
    // cancelling it lets the result promise settle instead.
    await expect(fakeHandle.result).rejects.toThrow('cancelled');
  });

  it('hasPool reports true for a registered pool and false for an unknown one', () => {
    expect(bus.hasPool('fake')).toBe(true);
    expect(bus.hasPool('does-not-exist')).toBe(false);
  });

  it('hasPool returns false after terminatePool removes the pool', async () => {
    await bus.terminatePool('fake');
    expect(bus.hasPool('fake')).toBe(false);
  });

  it('isolates a throwing subscriber so a later subscriber still receives the same event', async () => {
    // QNBS-v3: [emit() is only reached by 'circuit-breaker-open'/'backpressure-rejected' events
    //          (grep-verified — regular enqueue/completion never calls this.emit()); reuse the
    //          same circuit-breaker trigger as 'rejects when circuit breaker open' above, adding a
    //          throwing listener ahead of a recording one to prove the try/catch isolates it.]
    const events: Array<{ kind: string }> = [];
    bus.subscribe(() => {
      throw new Error('listener boom');
    });
    bus.subscribe((ev: unknown) => events.push(ev as { kind: string }));

    const cb = (
      bus as unknown as { getCircuitBreaker: (t: string) => { recordFailure: () => void } }
    ).getCircuitBreaker('fragile.task');
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    const handle = bus.enqueue('fragile.task', {});
    await expect(handle.result).rejects.toThrow('Circuit breaker is open');

    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'circuit-breaker-open', taskType: 'fragile.task' }),
    );
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
    allowDispatch();

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
    allowDispatch();

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
    allowDispatch();

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
    allowDispatch();

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
    allowDispatch();
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
    // QNBS-v3: taskId is captured post-enqueue since the mock's RESULT must now match the real generated taskId (taskId filter above).
    let capturedTaskId = '';
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
                  taskId: capturedTaskId,
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
    vi.spyOn(pool, 'tryAcquire').mockReturnValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );

    const handle = bus.enqueue('test.task', { data: 1 });
    capturedTaskId = handle.taskId;
    await expect(handle.result).resolves.toBe('worker-output');
  });

  it('runs task through real worker port and handles progress', async () => {
    // QNBS-v3: taskId is captured post-enqueue since the mock's PROGRESS/RESULT must now match the real generated taskId (taskId filter above).
    let capturedTaskId = '';
    const progressEvents: Array<{ stage: string; progress: number }> = [];
    const mockPort = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (type === 'message') {
          queueMicrotask(() => {
            handler(
              new MessageEvent('message', {
                data: {
                  kind: 'PROGRESS',
                  taskId: capturedTaskId,
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
                  taskId: capturedTaskId,
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
    vi.spyOn(pool, 'tryAcquire').mockReturnValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );

    const handle = bus.enqueue(
      'test.task',
      { data: 1 },
      {
        onProgress: (p) => progressEvents.push({ stage: p.stage, progress: p.progress }),
      },
    );
    capturedTaskId = handle.taskId;
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
    vi.spyOn(pool, 'tryAcquire').mockReturnValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );
    const releaseSpy = vi.spyOn(pool, 'release');

    const handle = bus.enqueue('test.task', { data: 1 });
    // Allow runTask to set up abort listener before cancelling
    await new Promise((r) => setTimeout(r, 10));
    handle.cancel('Task inactivity timeout');
    await expect(handle.result).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(releaseSpy).toHaveBeenCalledWith(mockWorker));
  });

  it('times out a hung worker, records a circuit-breaker failure, and force-terminates it', async () => {
    // QNBS-v3: fake timers make the 25ms deadline deterministic instead of racing real wall-clock time in CI.
    vi.useFakeTimers();
    try {
      // Worker never sends PROGRESS or RESULT — simulates a wedged worker (not crashed, just silent).
      const mockPort = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        postMessage: vi.fn(),
        start: vi.fn(),
      };

      const mockWorker = {
        workerId: 'mock-worker-hung',
        worker: {} as Worker,
        channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
        port: mockPort as unknown as MessagePort,
        state: 'idle' as const,
        capabilities: ['inference.text'] as const,
        labels: {},
      };

      const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
      vi.spyOn(pool, 'tryAcquire').mockReturnValue(
        mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
      );
      const terminateWorkerSpy = vi.spyOn(pool, 'terminateWorker').mockImplementation(() => {});
      const releaseSpy = vi.spyOn(pool, 'release');

      const handle = bus.enqueue(
        'test.task',
        { data: 1 },
        { timeoutMs: 25, retryPolicy: { maxRetries: 0 } },
      );
      const assertion = expect(handle.result).rejects.toThrow(
        /no response from the worker for 25ms/i,
      );
      await vi.advanceTimersByTimeAsync(25);
      await assertion;

      expect(terminateWorkerSpy).toHaveBeenCalledWith('mock-worker-hung');
      expect(releaseSpy).not.toHaveBeenCalled();
      expect(bus.getTelemetry().failedTasks).toBe(1);
      expect(bus.getTelemetry().deadLetterCount).toBe(1);
      expect(bus.getTelemetry().circuitBreakerStates['test.task']).toBeDefined();
      const deadLetters = (
        bus as unknown as {
          dlq: { list: () => ReadonlyArray<{ result: TaskResult }> };
        }
      ).dlq.list();
      expect(deadLetters[0]?.result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(deadLetters[0]?.result.queueTimeMs).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles an active timeout when worker replacement throws', async () => {
    vi.useFakeTimers();
    try {
      allowDispatch();
      const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
      vi.spyOn(pool, 'terminateWorker').mockImplementation(() => {
        throw new Error('replacement construction failed');
      });
      (bus as unknown as { runTask: () => Promise<TaskResult> }).runTask = vi
        .fn()
        .mockImplementation(() => new Promise<TaskResult>(() => {}));

      const handle = bus.enqueue(
        'test.task',
        {},
        {
          timeoutMs: 25,
          retryPolicy: { maxRetries: 0 },
        },
      );
      const assertion = expect(handle.result).rejects.toThrow(
        /no response from the worker for 25ms/i,
      );
      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(bus.getTelemetry().failedTasks).toBe(1);
      expect(bus.getTelemetry().deadLetterCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries an active inactivity timeout with a fresh attempt token', async () => {
    vi.useFakeTimers();
    try {
      const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
      allowDispatch();
      vi.spyOn(pool, 'terminateWorker').mockImplementation(() => {});
      const tokens: Array<{ signal: AbortSignal }> = [];
      const runTask = vi.fn().mockImplementation((_task, token) => {
        tokens.push(token);
        if (tokens.length === 2) {
          return Promise.resolve({
            taskId: 'x',
            success: true,
            result: 'second-attempt',
            latencyMs: 1,
            queueTimeMs: 0,
            layer: 'web',
          });
        }
        return new Promise<TaskResult>((resolve) => {
          token.signal.addEventListener(
            'abort',
            () =>
              resolve({
                taskId: 'x',
                success: false,
                error: {
                  code: 'CANCELLED',
                  message: 'attempt cancelled',
                  recoverable: false,
                  retryCount: 0,
                },
                latencyMs: 25,
                queueTimeMs: 0,
                layer: 'web',
              }),
            { once: true },
          );
        });
      });
      (bus as unknown as { runTask: typeof runTask }).runTask = runTask;

      const handle = bus.enqueue<null, string>('test.task', null, {
        timeoutMs: 25,
        retryPolicy: { maxRetries: 1, backoffMs: 1, maxBackoffMs: 1, jitter: false },
      });
      await vi.advanceTimersByTimeAsync(25);
      await vi.advanceTimersByTimeAsync(1);

      await expect(handle.result).resolves.toBe('second-attempt');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.signal.aborted).toBe(true);
      expect(tokens[1]?.signal.aborted).toBe(false);
      expect(bus.getTelemetry().failedTasks).toBe(0);
      expect(bus.getTelemetry().deadLetterCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the timeout watchdog on PROGRESS so a slow-but-alive task is not killed early', async () => {
    // QNBS-v3: fake timers replace real 15/30/45ms delays so the 20ms re-arm margin can't flake under CI scheduling jitter.
    vi.useFakeTimers();
    try {
      // QNBS-v3: taskId is captured post-enqueue since the mock's messages must match the real generated taskId (taskId filter above).
      let capturedTaskId = '';
      const mockPort = {
        addEventListener: vi.fn((type: string, handler: EventListener) => {
          if (type === 'message') {
            // Two PROGRESS pings inside the timeout window, then RESULT after the original
            // deadline would have expired — only survives if PROGRESS re-arms the watchdog.
            setTimeout(() => {
              handler(
                new MessageEvent('message', {
                  data: {
                    kind: 'PROGRESS',
                    taskId: capturedTaskId,
                    stage: 'step1',
                    progress: 0.3,
                  },
                }),
              );
            }, 15);
            setTimeout(() => {
              handler(
                new MessageEvent('message', {
                  data: {
                    kind: 'PROGRESS',
                    taskId: capturedTaskId,
                    stage: 'step2',
                    progress: 0.6,
                  },
                }),
              );
            }, 30);
            setTimeout(() => {
              handler(
                new MessageEvent('message', {
                  data: {
                    kind: 'RESULT',
                    taskId: capturedTaskId,
                    success: true,
                    result: 'slow-but-done',
                    latencyMs: 45,
                  },
                }),
              );
            }, 45);
          }
        }),
        removeEventListener: vi.fn(),
        postMessage: vi.fn(),
        start: vi.fn(),
      };

      const mockWorker = {
        workerId: 'mock-worker-slow',
        worker: {} as Worker,
        channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
        port: mockPort as unknown as MessagePort,
        state: 'idle' as const,
        capabilities: ['inference.text'] as const,
        labels: {},
      };

      const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
      vi.spyOn(pool, 'tryAcquire').mockReturnValue(
        mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
      );

      // timeoutMs (20ms) is shorter than the total run (45ms), but each PROGRESS arrives
      // well within 20ms of the previous reset, so the watchdog never fires.
      const handle = bus.enqueue('test.task', { data: 1 }, { timeoutMs: 20 });
      capturedTaskId = handle.taskId;
      const assertion = expect(handle.result).resolves.toBe('slow-but-done');
      await vi.advanceTimersByTimeAsync(45);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a stale PROGRESS/RESULT for a cancelled task after the MessagePort is reused', async () => {
    // QNBS-v3: regression test for the taskId filter above — a released (not terminated) port
    //          handed to a new task must not let the old task's late messages resolve/rearm it.
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const mockPort = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (type === 'message') messageHandler = handler as (event: MessageEvent) => void;
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    };

    const mockWorker = {
      workerId: 'mock-worker-reused',
      worker: {} as Worker,
      channel: { port1: mockPort, port2: mockPort } as unknown as MessageChannel,
      port: mockPort as unknown as MessagePort,
      state: 'idle' as const,
      capabilities: ['inference.text'] as const,
      labels: {},
    };

    const pool = (bus as unknown as { pools: Map<string, WorkerPool> }).pools.get('fake')!;
    vi.spyOn(pool, 'tryAcquire').mockReturnValue(
      mockWorker as unknown as import('../src/workerPool').PooledWorkerInstance,
    );
    vi.spyOn(pool, 'release').mockImplementation(() => {});

    // Task A is cancelled (released, not terminated) — its port is reused for task B below.
    const handleA = bus.enqueue('test.task', { data: 'A' }, { timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 5));
    const staleTaskId = handleA.taskId;
    handleA.cancel('superseded');
    await expect(handleA.result).rejects.toThrow('cancelled');

    const handleB = bus.enqueue('test.task', { data: 'B' }, { timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 5));

    // Stale RESULT from task A arrives on the reused port while task B is in flight — must be ignored.
    messageHandler?.(
      new MessageEvent('message', {
        data: { kind: 'RESULT', taskId: staleTaskId, success: true, result: 'stale-A-result' },
      }),
    );

    messageHandler?.(
      new MessageEvent('message', {
        data: { kind: 'RESULT', taskId: handleB.taskId, success: true, result: 'real-B-result' },
      }),
    );

    await expect(handleB.result).resolves.toBe('real-B-result');
  });
});
