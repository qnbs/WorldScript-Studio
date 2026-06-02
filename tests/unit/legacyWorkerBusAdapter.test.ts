// QNBS-v3: Tests for LegacyWorkerBusAdapter — old ai-core WorkerBus API shim over v2 bus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyWorkerBusAdapter } from '../../services/legacyWorkerBusAdapter';

function makeMockBus() {
  const pendingResolvers: (() => void)[] = [];
  const handle = {
    taskId: 'v2-task-id',
    result: new Promise<unknown>((resolve) => {
      pendingResolvers.push(resolve as () => void);
    }),
    progress: (async function* () {})(),
    cancel: vi.fn(),
  };
  const bus = {
    enqueue: vi.fn(() => handle),
    cancel: vi.fn(() => true),
    getTelemetry: vi.fn(() => ({
      queueDepth: { critical: 0, high: 1, normal: 2, low: 3 },
      activeWorkers: 1,
      idleWorkers: 0,
      processedTasks: 5,
      failedTasks: 1,
      deadLetterCount: 0,
      avgQueueTimeMs: 10,
      avgExecutionMs: 100,
      peakLatencyMs: 200,
      errorRate: 0.2,
      circuitBreakerStates: {},
      lastSuccessAt: 1234567890,
    })),
    registerPool: vi.fn(),
    shutdown: vi.fn(),
    subscribe: vi.fn(),
  };
  return { bus, handle, resolveTask: () => pendingResolvers[0]?.() };
}

describe('LegacyWorkerBusAdapter', () => {
  let adapter: LegacyWorkerBusAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('enqueue', () => {
    it('calls v2 bus.enqueue with mapped priority and returns true', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const task = {
        id: 'old-task-1',
        type: 'inference.text',
        payload: { prompt: 'hello' },
        priority: 'high' as const,
        createdAt: Date.now(),
      };
      const result = adapter.enqueue(task);
      expect(result).toBe(true);
      expect(bus.enqueue).toHaveBeenCalledWith(
        'inference.text',
        { prompt: 'hello' },
        { priority: 'high' },
      );
    });

    it('includes transferables in enqueue options when present', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const buffer = new ArrayBuffer(8);
      const task = {
        id: 'old-task-2',
        type: 'crypto.pbkdf2',
        payload: {},
        priority: 'normal' as const,
        createdAt: Date.now(),
        transferables: [buffer],
      };
      adapter.enqueue(task);
      expect(bus.enqueue).toHaveBeenCalledWith(
        'crypto.pbkdf2',
        {},
        { priority: 'normal', transferables: [buffer] },
      );
    });

    it('returns false when v2 bus.enqueue throws (backpressure)', () => {
      const { bus } = makeMockBus();
      bus.enqueue.mockImplementation(() => {
        throw new Error('circuit open');
      });
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const result = adapter.enqueue({
        id: 'old-task-3',
        type: 'inference.text',
        payload: {},
        priority: 'low' as const,
        createdAt: Date.now(),
      });
      expect(result).toBe(false);
    });
  });

  describe('cancel', () => {
    it('delegates to v2 bus.cancel', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const cancelled = adapter.cancel('some-task-id');
      expect(cancelled).toBe(true);
      expect(bus.cancel).toHaveBeenCalledWith('some-task-id');
    });
  });

  describe('dequeue', () => {
    it('always returns undefined (v2 auto-executes tasks)', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      expect(adapter.dequeue()).toBeUndefined();
    });
  });

  describe('registerTask', () => {
    it('returns an AbortSignal that is not yet aborted', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const signal = adapter.registerTask('tid-42');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });
  });

  describe('getTelemetry', () => {
    it('returns telemetry in the old ai-core format with v2 queue depths', () => {
      const { bus } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      const tel = adapter.getTelemetry();
      expect(tel.queueDepth.high).toBe(1);
      expect(tel.queueDepth.normal).toBe(2);
      expect(tel).toHaveProperty('processedTasks');
      expect(tel).toHaveProperty('avgExecutionMs');
      expect(tel).toHaveProperty('peakLatencyMs');
      expect(tel).toHaveProperty('errorRate');
      expect(tel).toHaveProperty('lastSuccessAt');
    });

    it('tracks processed tasks via handle.result promise resolution', async () => {
      const { bus, resolveTask } = makeMockBus();
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast
      adapter = new LegacyWorkerBusAdapter(bus as any);
      adapter.enqueue({
        id: 'tel-task',
        type: 'inference.text',
        payload: {},
        priority: 'normal' as const,
        createdAt: Date.now(),
      });
      resolveTask();
      // flush promise chain
      await Promise.resolve();
      await Promise.resolve();
      const tel = adapter.getTelemetry();
      expect(tel.processedTasks).toBe(1);
      expect(tel.failedTasks).toBe(0);
    });
  });
});
