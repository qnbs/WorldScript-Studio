// QNBS-v3: Tests for workerBusManager — WorkerBus v2 singleton lifecycle.
// vi.hoisted is used for mocks that must be available before module-level vi.mock calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: vi.hoisted ensures these references are available inside the vi.mock factory
//          which is hoisted before all imports.
const { mockShutdown, mockRegisterPool, mockInstall, MockWorkBus, MockRegistry } = vi.hoisted(
  () => {
    const mockShutdown = vi.fn().mockResolvedValue(undefined);
    const mockRegisterPool = vi.fn();
    const mockInstall = vi.fn();

    // QNBS-v3: Regular function (not arrow) so new MockWorkBus() works as a constructor.
    const MockWorkBus = vi.fn(function (this: Record<string, unknown>) {
      this.shutdown = mockShutdown;
      this.registerPool = mockRegisterPool;
      this.enqueue = vi.fn();
      this.cancel = vi.fn(() => true);
      this.getTelemetry = vi.fn(() => ({
        queueDepth: { critical: 0, high: 0, normal: 0, low: 0 },
        activeWorkers: 0,
        idleWorkers: 0,
        processedTasks: 0,
        failedTasks: 0,
        deadLetterCount: 0,
        avgQueueTimeMs: 0,
        avgExecutionMs: 0,
        peakLatencyMs: 0,
        errorRate: 0,
        circuitBreakerStates: {},
        lastSuccessAt: null,
      }));
      this.subscribe = vi.fn();
    });

    const MockRegistry = vi.fn(function (this: Record<string, unknown>) {
      this.register = vi.fn();
      this.install = mockInstall;
    });

    return { mockShutdown, mockRegisterPool, mockInstall, MockWorkBus, MockRegistry };
  },
);

vi.mock('@domain/worker-bus', () => ({
  WorkerBus: MockWorkBus,
  WorkerRegistry: MockRegistry,
  MAX_WORKERS_INFERENCE: 4,
  MIN_WORKERS: 1,
  WORKER_IDLE_TIMEOUT_MS: 120_000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RECOVERY_MS: 30_000,
  DEAD_LETTER_CAPACITY: 64,
  MAX_QUEUE_SIZE: 32,
  MAX_PREEMPTIONS: 3,
}));

vi.mock('../../services/legacyWorkerBusAdapter', () => ({
  LegacyWorkerBusAdapter: vi.fn(function (this: Record<string, unknown>) {
    this.getTelemetry = vi.fn();
  }),
}));

describe('workerBusManager', () => {
  beforeEach(() => {
    vi.resetModules();
    MockWorkBus.mockClear();
    MockRegistry.mockClear();
    mockShutdown.mockClear();
    mockRegisterPool.mockClear();
    mockInstall.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getWorkerBus returns null before init', async () => {
    const { getWorkerBus } = await import('../../services/workerBusManager');
    expect(getWorkerBus()).toBeNull();
  });

  it('isWorkerBusReady returns false before init', async () => {
    const { isWorkerBusReady } = await import('../../services/workerBusManager');
    expect(isWorkerBusReady()).toBe(false);
  });

  it('initWorkerBus creates a WorkerBus and installs pools via registry', async () => {
    const { initWorkerBus, getWorkerBus, isWorkerBusReady } = await import(
      '../../services/workerBusManager'
    );
    await initWorkerBus();
    expect(MockWorkBus).toHaveBeenCalledOnce();
    expect(MockRegistry).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    expect(getWorkerBus()).not.toBeNull();
    expect(isWorkerBusReady()).toBe(true);
  });

  it('initWorkerBus is idempotent — second call is a no-op', async () => {
    const { initWorkerBus } = await import('../../services/workerBusManager');
    await initWorkerBus();
    await initWorkerBus();
    expect(MockWorkBus).toHaveBeenCalledOnce();
  });

  it('shutdownWorkerBus calls bus.shutdown and clears state', async () => {
    const { initWorkerBus, shutdownWorkerBus, getWorkerBus } = await import(
      '../../services/workerBusManager'
    );
    await initWorkerBus();
    await shutdownWorkerBus();
    expect(mockShutdown).toHaveBeenCalledOnce();
    expect(getWorkerBus()).toBeNull();
  });

  it('shutdownWorkerBus is safe when not initialized', async () => {
    const { shutdownWorkerBus } = await import('../../services/workerBusManager');
    await expect(shutdownWorkerBus()).resolves.toBeUndefined();
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it('initWorkerBusOnStartup(false) does not initialize', async () => {
    const { initWorkerBusOnStartup, isWorkerBusReady } = await import(
      '../../services/workerBusManager'
    );
    await initWorkerBusOnStartup(false);
    expect(isWorkerBusReady()).toBe(false);
    expect(MockWorkBus).not.toHaveBeenCalled();
  });

  it('initWorkerBusOnStartup(true) initializes the bus', async () => {
    const { initWorkerBusOnStartup, isWorkerBusReady } = await import(
      '../../services/workerBusManager'
    );
    await initWorkerBusOnStartup(true);
    expect(isWorkerBusReady()).toBe(true);
  });

  it('getLegacyAdapter returns non-null after init', async () => {
    const { initWorkerBus, getLegacyAdapter } = await import('../../services/workerBusManager');
    await initWorkerBus();
    expect(getLegacyAdapter()).not.toBeNull();
  });
});
