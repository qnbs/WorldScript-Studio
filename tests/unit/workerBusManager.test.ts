// QNBS-v3: Tests for workerBusManager — WorkerBus v2 singleton lifecycle.
// vi.hoisted is used for mocks that must be available before module-level vi.mock calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: vi.hoisted ensures these references are available inside the vi.mock factory
//          which is hoisted before all imports.
const { mockShutdown, mockRegisterPool, mockHasPool, mockInstall, MockWorkBus, MockRegistry } =
  vi.hoisted(() => {
    const mockShutdown = vi.fn().mockResolvedValue(undefined);
    const mockRegisterPool = vi.fn();
    // QNBS-v3: [Defaults to true (pool present) so existing tests that don't care about
    //          re-registration behavior are unaffected; the dedicated ensureDuckDbPool tests
    //          override this per-case.]
    const mockHasPool = vi.fn(() => true);
    const mockInstall = vi.fn();

    // QNBS-v3: Regular function (not arrow) so new MockWorkBus() works as a constructor.
    //          Bracket notation required — noPropertyAccessFromIndexSignature is enabled.
    const MockWorkBus = vi.fn(function (this: Record<string, unknown>) {
      this['shutdown'] = mockShutdown;
      this['registerPool'] = mockRegisterPool;
      this['hasPool'] = mockHasPool;
      this['enqueue'] = vi.fn();
      this['cancel'] = vi.fn(() => true);
      this['getTelemetry'] = vi.fn(() => ({
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
      this['subscribe'] = vi.fn();
    });

    const MockRegistry = vi.fn(function (this: Record<string, unknown>) {
      this['register'] = vi.fn();
      this['install'] = mockInstall;
    });

    return { mockShutdown, mockRegisterPool, mockHasPool, mockInstall, MockWorkBus, MockRegistry };
  });

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
    this['getTelemetry'] = vi.fn();
  }),
}));

describe('workerBusManager', () => {
  beforeEach(() => {
    vi.resetModules();
    MockWorkBus.mockClear();
    MockRegistry.mockClear();
    mockShutdown.mockClear();
    mockRegisterPool.mockClear();
    mockHasPool.mockClear();
    mockHasPool.mockReturnValue(true);
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

  describe('ensureDuckDbPool', () => {
    it('initializes the bus when not yet running', async () => {
      const { ensureDuckDbPool, isWorkerBusReady } = await import(
        '../../services/workerBusManager'
      );
      const bus = await ensureDuckDbPool();
      expect(bus).not.toBeNull();
      expect(isWorkerBusReady()).toBe(true);
    });

    it('does not re-register the pool when it is already present', async () => {
      const { initWorkerBus, ensureDuckDbPool } = await import('../../services/workerBusManager');
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(true);

      await ensureDuckDbPool();

      expect(mockHasPool).toHaveBeenCalledWith('duckdb');
      expect(mockRegisterPool).not.toHaveBeenCalled();
    });

    it('re-registers the duckdb pool when the bus is alive but the pool was removed', async () => {
      // QNBS-v3: [Simulates the gap terminatePool('duckdb') can leave — the bus stays non-null
      //          but the pool is gone; ensureDuckDbPool must not just trust `_bus !== null`.]
      const { initWorkerBus, ensureDuckDbPool } = await import('../../services/workerBusManager');
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(false);

      const bus = await ensureDuckDbPool();

      expect(bus).not.toBeNull();
      expect(mockRegisterPool).toHaveBeenCalledWith(
        'duckdb',
        expect.arrayContaining(['db.duckdb']),
        expect.objectContaining({ workerScript: expect.stringContaining('duckdb.worker') }),
      );
    });
  });

  describe('ensureInferencePool', () => {
    // QNBS-v3: [Imports the real module (only @domain/worker-bus is mocked) — unlike
    //          localEmbeddingService.test.ts's fully-mocked workerBusManager, this actually
    //          exercises the export surface. This exact suite would have caught PR #288's
    //          missing-export bug (ensureInferencePool was imported but never defined).]
    it('initializes the bus when not yet running', async () => {
      const { ensureInferencePool, isWorkerBusReady } = await import(
        '../../services/workerBusManager'
      );
      const bus = await ensureInferencePool();
      expect(bus).not.toBeNull();
      expect(isWorkerBusReady()).toBe(true);
    });

    it('does not re-register the pool when it is already present', async () => {
      const { initWorkerBus, ensureInferencePool } = await import(
        '../../services/workerBusManager'
      );
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(true);

      await ensureInferencePool();

      expect(mockHasPool).toHaveBeenCalledWith('inference');
      expect(mockRegisterPool).not.toHaveBeenCalled();
    });

    it('re-registers the inference pool when the bus is alive but the pool was removed', async () => {
      const { initWorkerBus, ensureInferencePool } = await import(
        '../../services/workerBusManager'
      );
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(false);

      const bus = await ensureInferencePool();

      expect(bus).not.toBeNull();
      expect(mockRegisterPool).toHaveBeenCalledWith(
        'inference',
        expect.arrayContaining(['inference.text', 'inference.embed']),
        expect.objectContaining({
          maxWorkers: 2,
          workerScript: expect.stringContaining('inference.worker'),
        }),
      );
    });
  });
});
