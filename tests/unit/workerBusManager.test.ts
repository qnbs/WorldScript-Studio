// QNBS-v3: Tests for workerBusManager — WorkerBus v2 singleton lifecycle.
// vi.hoisted is used for mocks that must be available before module-level vi.mock calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: vi.hoisted ensures these references are available inside the vi.mock factory
//          which is hoisted before all imports.
const {
  mockShutdown,
  mockRegisterPool,
  mockHasPool,
  mockInstall,
  mockRegister,
  MockWorkBus,
  MockRegistry,
} = vi.hoisted(() => {
  const mockShutdown = vi.fn().mockResolvedValue(undefined);
  const mockRegisterPool = vi.fn();
  // QNBS-v3: [Defaults to true (pool present) so tests that ignore re-registration are unaffected; ensureDuckDbPool tests override it.]
  const mockHasPool = vi.fn(() => true);
  const mockInstall = vi.fn();

  // QNBS-v3: Regular function (not arrow) so new MockWorkBus() works as a constructor; bracket notation for noPropertyAccessFromIndexSignature.
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

  const mockRegister = vi.fn();
  const MockRegistry = vi.fn(function (this: Record<string, unknown>) {
    this['register'] = mockRegister;
    this['install'] = mockInstall;
  });

  return {
    mockShutdown,
    mockRegisterPool,
    mockHasPool,
    mockInstall,
    mockRegister,
    MockWorkBus,
    MockRegistry,
  };
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

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

// QNBS-v3: mocked separately so re-registration-failure tests can assert on log.error without asserting on the real StructuredLogger's console/IDB side effects
vi.mock('../../services/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLogError,
    withContext: vi.fn(),
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
    mockRegister.mockClear();
    mockLogError.mockClear();
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

  // #1272: production shipped every worker as raw TypeScript. Vite's worker plugin marks a URL it bundles as a
  // worker entry (`?worker_file`), so this pins that each pool starts its own script in the bundled shape.
  it('each pool factory starts its own worker script as a Vite-bundled module worker', async () => {
    const started: Array<{ path: string; viteWorkerEntry: boolean; type: string | undefined }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL | string, options?: WorkerOptions) {
          const parsed = new URL(String(url));
          started.push({
            path: parsed.pathname,
            viteWorkerEntry: parsed.searchParams.has('worker_file'),
            type: options?.type,
          });
        }
      },
    );
    try {
      const { initWorkerBus } = await import('../../services/workerBusManager');
      await initWorkerBus();
      const factories = new Map<string, () => unknown>(
        mockRegister.mock.calls.map(([entry]) => [entry.poolId, entry.options.createWorker]),
      );
      const scripts = {
        inference: '/workers/v2/inference.worker.ts',
        duckdb: '/workers/v2/duckdb.worker.ts',
        webllm: '/workers/v2/webllm.worker.ts',
        plugin: '/workers/plugin.worker.ts',
      };
      for (const [pool, script] of Object.entries(scripts)) {
        started.length = 0;
        factories.get(pool)?.();
        expect(started, pool).toEqual([{ path: script, viteWorkerEntry: true, type: 'module' }]);
      }
      expect([...factories.keys()].sort()).toEqual(Object.keys(scripts).sort());
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('shutdown invalidates a pending start before it can allocate or publish a bus', async () => {
    const manager = await import('../../services/workerBusManager');
    const starting = manager.initWorkerBus();
    await manager.shutdownWorkerBus();
    await starting;
    expect(manager.getWorkerBus()).toBeNull();
    expect(manager.getLegacyAdapter()).toBeNull();
    expect(MockWorkBus).not.toHaveBeenCalled();
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('a fresh start after a stop does not share the invalidated initialization', async () => {
    const manager = await import('../../services/workerBusManager');
    const oldStart = manager.initWorkerBus();
    await manager.shutdownWorkerBus();
    const newStart = manager.initWorkerBus();
    const concurrentStart = manager.initWorkerBus();
    await Promise.all([oldStart, newStart, concurrentStart]);
    expect(manager.isWorkerBusReady()).toBe(true);
    expect(MockWorkBus).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    await manager.shutdownWorkerBus();
  });

  it('repeated stops invalidate a pending start and still allow on-demand inference later', async () => {
    const manager = await import('../../services/workerBusManager');
    const starting = manager.initWorkerBus();
    await manager.shutdownWorkerBus();
    await manager.shutdownWorkerBus();
    await starting;
    expect(manager.isWorkerBusReady()).toBe(false);
    const bus = await manager.ensureInferencePool();
    expect(bus).not.toBeNull();
    expect(MockWorkBus).toHaveBeenCalledOnce();
    await manager.shutdownWorkerBus();
  });

  it.each(['ensureDuckDbPool', 'ensureInferencePool'] as const)(
    '%s does not re-register a pool on a bus stopped while options were loading',
    async (ensurePool) => {
      const manager = await import('../../services/workerBusManager');
      await manager.initWorkerBus();
      mockHasPool.mockReturnValue(false);
      const ensuring = manager[ensurePool]();
      await manager.shutdownWorkerBus();
      expect(await ensuring).toBeNull();
      expect(mockRegisterPool).not.toHaveBeenCalled();
    },
  );

  it('cleans up a partially installed bus and permits a later retry', async () => {
    const manager = await import('../../services/workerBusManager');
    mockInstall.mockImplementationOnce(() => {
      throw new Error('pool installation failed');
    });
    await manager.initWorkerBus();
    expect(manager.isWorkerBusReady()).toBe(false);
    expect(manager.getLegacyAdapter()).toBeNull();
    expect(mockShutdown).toHaveBeenCalledOnce();
    await manager.initWorkerBus();
    expect(manager.isWorkerBusReady()).toBe(true);
    await manager.shutdownWorkerBus();
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
        expect.objectContaining({ createWorker: expect.any(Function) }),
      );
    });

    it('logs and returns the live bus instead of rejecting when re-registration fails', async () => {
      // QNBS-v3: [Regression guard for the documented "null only if init failed" contract — a
      //          re-registration failure must not propagate out of ensureDuckDbPool.]
      const { initWorkerBus, ensureDuckDbPool } = await import('../../services/workerBusManager');
      await initWorkerBus();
      mockHasPool.mockReturnValue(false);
      mockRegisterPool.mockImplementationOnce(() => {
        throw new Error('registerPool boom');
      });

      const bus = await ensureDuckDbPool();

      expect(bus).not.toBeNull();
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to re-register duckdb pool',
        expect.any(Error),
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
      // QNBS-v3: asserts the memory-safety cap (below MAX_WORKERS_INFERENCE) survives re-registration, not just initial registration
      expect(mockRegisterPool).toHaveBeenCalledWith(
        'inference',
        expect.arrayContaining(['inference.text', 'inference.embed']),
        expect.objectContaining({
          maxWorkers: 2,
          createWorker: expect.any(Function),
        }),
      );
    });

    it('logs and returns the live bus instead of rejecting when re-registration fails', async () => {
      // QNBS-v3: [Regression guard for the documented "null only if init failed" contract — a
      //          re-registration failure must not propagate out of ensureInferencePool.]
      const { initWorkerBus, ensureInferencePool } = await import(
        '../../services/workerBusManager'
      );
      await initWorkerBus();
      mockHasPool.mockReturnValue(false);
      mockRegisterPool.mockImplementationOnce(() => {
        throw new Error('registerPool boom');
      });

      const bus = await ensureInferencePool();

      expect(bus).not.toBeNull();
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to re-register inference pool',
        expect.any(Error),
      );
    });
  });

  describe('inference pool sizing by memory tier', () => {
    // QNBS-v3: verified via ensureInferencePool()'s re-registration path — initWorkerBus() only calls the mocked registry.register(), not bus.registerPool().
    afterEach(() => {
      vi.doUnmock('../../services/ai/localAiDeviceProfiler');
    });

    async function expectMaxWorkersForTier(
      detectMemoryTier: () => 'high' | 'medium' | 'low',
      expectedMaxWorkers: number,
    ): Promise<void> {
      vi.doMock('../../services/ai/localAiDeviceProfiler', () => ({ detectMemoryTier }));
      const { initWorkerBus, ensureInferencePool } = await import(
        '../../services/workerBusManager'
      );
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(false);

      await ensureInferencePool();

      expect(mockRegisterPool).toHaveBeenCalledWith(
        'inference',
        expect.arrayContaining(['inference.text', 'inference.embed']),
        expect.objectContaining({ maxWorkers: expectedMaxWorkers }),
      );
    }

    it('sizes maxWorkers to 3 on a high memory tier', async () => {
      await expectMaxWorkersForTier(() => 'high', 3);
    });

    it('sizes maxWorkers to 2 on a medium memory tier (unchanged default)', async () => {
      await expectMaxWorkersForTier(() => 'medium', 2);
    });

    it('sizes maxWorkers to 1 on a low memory tier', async () => {
      await expectMaxWorkersForTier(() => 'low', 1);
    });

    it('falls back to maxWorkers 2 when memory-tier detection throws', async () => {
      vi.doMock('../../services/ai/localAiDeviceProfiler', () => ({
        detectMemoryTier: () => {
          throw new Error('profiler boom');
        },
      }));
      const { initWorkerBus, ensureInferencePool } = await import(
        '../../services/workerBusManager'
      );
      await initWorkerBus();
      mockRegisterPool.mockClear();
      mockHasPool.mockReturnValue(false);

      await ensureInferencePool();

      expect(mockRegisterPool).toHaveBeenCalledWith(
        'inference',
        expect.arrayContaining(['inference.text', 'inference.embed']),
        expect.objectContaining({ maxWorkers: 2 }),
      );
    });
  });
});
