import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTaskConfig = vi.fn();
const mockPrewarmModel = vi.fn().mockResolvedValue(undefined);
const mockRecordTaskLatency = vi.fn();

vi.mock('../../../../services/ai/adaptiveAiEngine', () => ({
  adaptiveAiEngine: {
    getTaskConfig: (...args: unknown[]) => mockGetTaskConfig(...args),
    prewarmModel: (...args: unknown[]) => mockPrewarmModel(...args),
    recordTaskLatency: (...args: unknown[]) => mockRecordTaskLatency(...args),
  },
}));

vi.mock('@domain/ai-core', () => ({
  runLocalTextGeneration: vi.fn().mockResolvedValue({ layer: 'onnx-wasm', text: 'test output' }),
}));

// Mock localStorage
const localStorageData: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => localStorageData[k] ?? null,
  setItem: (k: string, v: string) => {
    localStorageData[k] = v;
  },
  removeItem: (k: string) => {
    delete localStorageData[k];
  },
});

import {
  clearBenchmarkResults,
  getLastBenchmarkResults,
  runAllBenchmarks,
  runInferenceBenchmark,
} from '../../../../services/ai/benchmarkService';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('benchmarkService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(localStorageData).forEach((k) => {
      delete localStorageData[k];
    });
    mockGetTaskConfig.mockResolvedValue({
      backend: 'onnx-wasm',
      modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      estimatedLatencyMs: 500,
      powerPreference: 'default',
    });
  });

  afterEach(() => {
    Object.keys(localStorageData).forEach((k) => {
      delete localStorageData[k];
    });
  });

  describe('runInferenceBenchmark', () => {
    it('returns a BenchmarkResult with correct shape', async () => {
      const result = await runInferenceBenchmark('text-gen-short');
      expect(result).toMatchObject({
        taskType: 'text-gen-short',
        backend: 'onnx-wasm',
        modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      });
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.timestamp).toBe('number');
    });

    it('calls prewarmModel before measuring', async () => {
      await runInferenceBenchmark('embedding');
      expect(mockPrewarmModel).toHaveBeenCalledWith('embedding');
    });

    it('feeds latency back to adaptiveAiEngine.recordTaskLatency', async () => {
      await runInferenceBenchmark('text-gen-short');
      expect(mockRecordTaskLatency).toHaveBeenCalledWith(
        'text-gen-short',
        'onnx-wasm',
        'HuggingFaceTB/SmolLM2-135M-Instruct',
        expect.any(Number),
      );
    });

    it('persists result to localStorage', async () => {
      await runInferenceBenchmark('text-gen-short');
      const stored = getLastBenchmarkResults();
      expect(stored.length).toBeGreaterThanOrEqual(1);
      expect(stored[0]?.taskType).toBe('text-gen-short');
    });
  });

  describe('getLastBenchmarkResults', () => {
    it('returns empty array when no results stored', () => {
      expect(getLastBenchmarkResults()).toEqual([]);
    });

    it('returns results in reverse chronological order', async () => {
      await runInferenceBenchmark('text-gen-short');
      await runInferenceBenchmark('embedding');
      const results = getLastBenchmarkResults();
      expect(results.length).toBe(2);
      // Most recent first
      expect(results[0]?.taskType).toBe('embedding');
    });
  });

  describe('clearBenchmarkResults', () => {
    it('removes stored results from localStorage', async () => {
      await runInferenceBenchmark('text-gen-short');
      clearBenchmarkResults();
      expect(getLastBenchmarkResults()).toEqual([]);
    });
  });

  describe('runAllBenchmarks', () => {
    it('runs benchmarks for all standard task types', async () => {
      const results = await runAllBenchmarks();
      expect(results.length).toBe(4);
      expect(results.map((r) => r.taskType)).toEqual([
        'text-gen-short',
        'embedding',
        'rag-rank',
        'summarize',
      ]);
    });

    it('continues on individual task failure', async () => {
      mockGetTaskConfig.mockRejectedValueOnce(new Error('Config failed'));
      const results = await runAllBenchmarks();
      // Should still get 4 results (some may be partial/fallback)
      expect(results.length).toBe(4);
    });
  });
});
