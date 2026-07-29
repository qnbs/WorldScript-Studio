// QNBS-v3: Phase 2 — WorkerBus v2 singleton manager. Initializes on flag enable, terminates on
//          flag disable. Exposes getWorkerBus() for new callers and getLegacyAdapter() for old
//          callers still using the ai-core WorkerBus API surface.

import type { WorkerBus } from '@domain/worker-bus';
import { LegacyWorkerBusAdapter } from './legacyWorkerBusAdapter';
import { createLogger } from './logger';

const log = createLogger('workerBusManager');

let _bus: WorkerBus | null = null;
let _adapter: LegacyWorkerBusAdapter | null = null;
// QNBS-v3: CodeAnt — hold the in-flight init promise so concurrent callers AWAIT it instead of
//          returning early while `_bus` is still null (which caused sporadic main-thread fallback).
let _initPromise: Promise<void> | null = null;

/** Returns the active WorkerBus v2 instance, or null if not yet initialized. */
export function getWorkerBus(): WorkerBus | null {
  return _bus;
}

/** Returns the LegacyWorkerBusAdapter for old ai-core callers, or null if not initialized. */
export function getLegacyAdapter(): LegacyWorkerBusAdapter | null {
  return _adapter;
}

/** True when the WorkerBus v2 is initialized and ready to accept tasks. */
export function isWorkerBusReady(): boolean {
  return _bus !== null;
}

/**
 * Initialize WorkerBus v2 with inference and DuckDB worker pools.
 * Idempotent — concurrent/repeated calls are no-ops.
 */
export async function initWorkerBus(): Promise<void> {
  if (_bus !== null) return;
  // QNBS-v3: CodeAnt — concurrent callers share the single in-flight init promise (and await it),
  //          so none returns before `_bus` is set.
  if (_initPromise) return _initPromise;
  _initPromise = doInitWorkerBus();
  try {
    await _initPromise;
  } finally {
    _initPromise = null;
  }
}

// QNBS-v3: [Shared with reRegisterDuckDbPool() below so a pool removed via terminatePool() gets re-registered with identical options, not a drifted copy.]
async function duckDbPoolOptions() {
  const { WORKER_IDLE_TIMEOUT_MS } = await import('@domain/worker-bus');
  return {
    // QNBS-v3: DuckDB is single-writer — minWorkers 0 keeps the thread alive only while in use.
    maxWorkers: 1,
    minWorkers: 0,
    idleTimeoutMs: WORKER_IDLE_TIMEOUT_MS,
    workerScript: new URL('../workers/v2/duckdb.worker.ts', import.meta.url).href,
    capabilities: ['db.duckdb'] as const,
    labels: { pool: 'duckdb', version: 'v2' },
  };
}

/** Re-register the 'duckdb' pool if it was removed via terminatePool() — a no-op if it's already present. */
async function reRegisterDuckDbPool(bus: WorkerBus): Promise<void> {
  if (bus.hasPool('duckdb')) return;
  const options = await duckDbPoolOptions();
  bus.registerPool('duckdb', options.capabilities, options);
}

// QNBS-v3: [Shared with reRegisterInferencePool() below, same rationale as duckDbPoolOptions().]
async function inferencePoolOptions() {
  const { MAX_WORKERS_INFERENCE, MIN_WORKERS, WORKER_IDLE_TIMEOUT_MS } = await import(
    '@domain/worker-bus'
  );
  return {
    // QNBS-v3: [Capped below MAX_WORKERS_INFERENCE — each replica loads its own transformers.js pipeline (no cross-replica cache sharing), so 4 concurrent workers could mean 4x the model memory footprint under a burst.]
    maxWorkers: Math.min(2, MAX_WORKERS_INFERENCE),
    minWorkers: MIN_WORKERS,
    idleTimeoutMs: WORKER_IDLE_TIMEOUT_MS,
    workerScript: new URL('../workers/v2/inference.worker.ts', import.meta.url).href,
    capabilities: ['inference.text', 'inference.embed'] as const,
    labels: { pool: 'inference', version: 'v2' },
  };
}

/** Re-register the 'inference' pool if it was removed via terminatePool() — a no-op if already present. */
async function reRegisterInferencePool(bus: WorkerBus): Promise<void> {
  if (bus.hasPool('inference')) return;
  const options = await inferencePoolOptions();
  bus.registerPool('inference', options.capabilities, options);
}

async function doInitWorkerBus(): Promise<void> {
  try {
    const {
      WorkerBus,
      WorkerRegistry,
      MAX_WORKERS_INFERENCE,
      WORKER_IDLE_TIMEOUT_MS,
      CIRCUIT_BREAKER_THRESHOLD,
      CIRCUIT_BREAKER_RECOVERY_MS,
      DEAD_LETTER_CAPACITY,
      MAX_QUEUE_SIZE,
      MAX_PREEMPTIONS,
    } = await import('@domain/worker-bus');

    const bus = new WorkerBus({
      maxQueueSize: MAX_QUEUE_SIZE,
      maxPreemptions: MAX_PREEMPTIONS,
      workerPoolSize: MAX_WORKERS_INFERENCE,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerRecoveryMs: CIRCUIT_BREAKER_RECOVERY_MS,
      enableDeadLetter: true,
      deadLetterCapacity: DEAD_LETTER_CAPACITY,
      enableTracing: false,
    });

    const registry = new WorkerRegistry();

    // QNBS-v3: P1-1 — dedicated WebLLM (WebGPU) worker. Separate pool keeps @mlc-ai/web-llm out
    //          of the transformers.js worker bundle and isolates the GPU lifecycle.
    const webllmUrl = new URL('../workers/v2/webllm.worker.ts', import.meta.url).href;

    const inferenceOptions = await inferencePoolOptions();
    registry.register({
      poolId: 'inference',
      capabilities: inferenceOptions.capabilities,
      options: inferenceOptions,
    });

    const duckdbOptions = await duckDbPoolOptions();
    registry.register({
      poolId: 'duckdb',
      capabilities: duckdbOptions.capabilities,
      options: duckdbOptions,
    });

    // QNBS-v3: P1-1 — WebLLM pool. maxWorkers:1 (single heavy GPU consumer; tab-leader election
    //          already serializes across tabs), minWorkers:0 so the GPU thread spins up on demand.
    registry.register({
      poolId: 'webllm',
      capabilities: ['inference.webllm'],
      options: {
        maxWorkers: 1,
        minWorkers: 0,
        idleTimeoutMs: WORKER_IDLE_TIMEOUT_MS,
        workerScript: webllmUrl,
        capabilities: ['inference.webllm'],
        labels: { pool: 'webllm', version: 'v2' },
      },
    });

    // QNBS-v3: Plugin worker pool — isolated execution for sandboxed plugins (P0-2).
    const pluginUrl = new URL('../workers/plugin.worker.ts', import.meta.url).href;
    registry.register({
      poolId: 'plugin',
      capabilities: ['plugin.execute'],
      options: {
        maxWorkers: 1,
        minWorkers: 0,
        idleTimeoutMs: WORKER_IDLE_TIMEOUT_MS,
        workerScript: pluginUrl,
        capabilities: ['plugin.execute'],
        labels: { pool: 'plugin', version: 'v1' },
      },
    });

    registry.install(bus);
    _bus = bus;
    _adapter = new LegacyWorkerBusAdapter(bus);

    log.info('WorkerBus v2 initialized', { pools: ['inference', 'webllm', 'duckdb', 'plugin'] });
  } catch (err) {
    log.error(
      'WorkerBus v2 initialization failed',
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/**
 * Ensure the WebLLM worker pool is available, initializing the WorkerBus on demand.
 * QNBS-v3: P1-1 — WebLLM offload is "always-on" and therefore decoupled from the
 *          `enableWorkerBusV2` feature flag: local AI must run off-thread regardless of whether
 *          the broader WorkerBus v2 rollout is enabled. Returns null only if init failed.
 */
export async function ensureWebLlmPool(): Promise<WorkerBus | null> {
  if (_bus === null) await initWorkerBus();
  return _bus;
}

/**
 * Ensure the DuckDB worker pool is available, initializing the WorkerBus on demand.
 * QNBS-v3: mirrors ensureWebLlmPool()'s decoupling from `enableWorkerBusV2` — DuckDB analytics
 * defaults on and was never gated by that flag in the v1 worker it replaces
 * (docs/adr/0014-worker-generation-duplication.md), so toggling an experimental infra flag off
 * must not silently break analytics. Returns null only if init failed.
 */
export async function ensureDuckDbPool(): Promise<WorkerBus | null> {
  if (_bus === null) {
    await initWorkerBus();
    return _bus;
  }
  // QNBS-v3: [terminatePool('duckdb') can remove the pool while the bus itself stays alive — re-register it here instead of assuming a non-null bus always has every pool.]
  await reRegisterDuckDbPool(_bus);
  return _bus;
}

/**
 * Ensure the shared local-inference worker pool is available, initializing the WorkerBus on
 * demand. QNBS-v3: mirrors ensureDuckDbPool()/ensureWebLlmPool()'s decoupling from
 * `enableWorkerBusV2` — embeddings/NLP were never gated by that flag in the v1 worker they
 * replace, so toggling an experimental infra flag off must not silently break RAG/cross-project
 * search. Returns null only if init failed.
 */
export async function ensureInferencePool(): Promise<WorkerBus | null> {
  if (_bus === null) {
    await initWorkerBus();
    return _bus;
  }
  await reRegisterInferencePool(_bus);
  return _bus;
}

/**
 * Shut down the WorkerBus v2 and terminate all worker threads.
 * Called when the feature flag is disabled or the app unmounts.
 */
export async function shutdownWorkerBus(): Promise<void> {
  if (_bus === null) return;
  const bus = _bus;
  _bus = null;
  _adapter = null;
  try {
    await bus.shutdown();
    log.info('WorkerBus v2 shut down cleanly');
  } catch (err) {
    log.warn('WorkerBus v2 shutdown error (non-critical)', err);
  }
}

/**
 * Called on app cold start — mirrors initAdaptiveAiOnStartup pattern from listenerMiddleware.
 * Listeners only fire on OFF→ON transitions; this handles the case where the flag was already
 * enabled in persisted localStorage state before the listener was registered.
 */
export async function initWorkerBusOnStartup(enabled: boolean): Promise<void> {
  if (!enabled) return;
  await initWorkerBus();
}
