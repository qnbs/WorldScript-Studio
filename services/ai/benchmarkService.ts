/**
 * benchmarkService.ts — Micro-benchmarks for local AI inference backends.
 * QNBS-v3: C1 — Measures latency per task type + backend. Results stored in localStorage.
 *          Gated by enableAdaptiveAiEngine feature flag; results feed adaptiveAiEngine latency history.
 */

import { logger as log } from '../logger';
import { type AiTaskType, adaptiveAiEngine } from './adaptiveAiEngine';
import type { ComputeBackend } from './localAiDeviceProfiler';

const BENCHMARK_STORAGE_KEY = 'worldscript-benchmarks';
const MAX_STORED_RESULTS = 50;
// Number of benchmark runs per task (first run discarded as warm-up)
const BENCHMARK_RUNS = 3;
// Short probe text used for all benchmark calls
const BENCHMARK_PROMPT = 'Once upon a time in a land far away,';

export interface BenchmarkResult {
  taskType: AiTaskType;
  backend: ComputeBackend;
  modelId: string;
  latencyMs: number;
  tokensPerSecond?: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function loadResults(): BenchmarkResult[] {
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BenchmarkResult[]) : [];
  } catch {
    return [];
  }
}

function saveResults(results: BenchmarkResult[]): void {
  try {
    // Keep only the most recent MAX_STORED_RESULTS entries
    const trimmed = results.slice(-MAX_STORED_RESULTS);
    localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    log.warn('Failed to persist benchmark results', err as Error);
  }
}

// ---------------------------------------------------------------------------
// Core benchmark runner
// ---------------------------------------------------------------------------

/**
 * Run a micro-benchmark for a single task type.
 * Performs BENCHMARK_RUNS inference calls, discards the first (warm-up),
 * and returns the average of the remaining runs.
 */
export async function runInferenceBenchmark(task: AiTaskType): Promise<BenchmarkResult> {
  const config = await adaptiveAiEngine.getTaskConfig(task);

  // Prewarm before measuring
  try {
    await adaptiveAiEngine.prewarmModel(task);
  } catch {
    // Prewarm failure is non-fatal; measurement continues
  }

  const times: number[] = [];

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();
    try {
      // Import lazily to avoid loading inference deps at module load time
      const { runLocalTextGeneration } = await import('@domain/ai-core');
      await runLocalTextGeneration(BENCHMARK_PROMPT, config.modelId);
    } catch {
      // Inference failure still records timing (latency of failure is informative)
    }
    times.push(performance.now() - start);
  }

  // Discard first run (warm-up), average the rest
  const measuredTimes = times.slice(1);
  const avgLatency =
    measuredTimes.length > 0
      ? measuredTimes.reduce((a, b) => a + b, 0) / measuredTimes.length
      : (times[0] ?? 0);

  const result: BenchmarkResult = {
    taskType: task,
    backend: config.backend,
    modelId: config.modelId,
    latencyMs: Math.round(avgLatency),
    timestamp: Date.now(),
  };

  // Feed result back into adaptive engine's latency history
  adaptiveAiEngine.recordTaskLatency(task, config.backend, config.modelId, result.latencyMs);

  // Persist
  const existing = loadResults();
  saveResults([...existing, result]);

  log.info('Benchmark complete', { task, backend: config.backend, latencyMs: result.latencyMs });
  return result;
}

/**
 * Run benchmarks for all standard task types sequentially.
 * Returns all results (including any that failed gracefully).
 */
export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const TASKS: AiTaskType[] = ['text-gen-short', 'embedding', 'rag-rank', 'summarize'];
  const results: BenchmarkResult[] = [];

  for (const task of TASKS) {
    try {
      const result = await runInferenceBenchmark(task);
      results.push(result);
    } catch (err) {
      log.warn(`Benchmark failed for task ${task}`, err as Error);
    }
  }

  return results;
}

/** Return all stored benchmark results (most recent first). */
export function getLastBenchmarkResults(): BenchmarkResult[] {
  return loadResults().reverse();
}

/** Clear all stored benchmark results. */
export function clearBenchmarkResults(): void {
  try {
    localStorage.removeItem(BENCHMARK_STORAGE_KEY);
  } catch (err) {
    log.warn('Failed to clear benchmark results', err as Error);
  }
}
