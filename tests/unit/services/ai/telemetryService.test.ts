import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExec = vi.fn().mockResolvedValue({ rows: [] });
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../../../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    exec: (...args: unknown[]) => mockExec(...args),
    query: (...args: unknown[]) => mockQuery(...args),
  },
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
  clearTelemetry,
  getRecentTelemetry,
  recordInferenceTelemetry,
  setTelemetryEnabled,
} from '../../../../services/ai/telemetryService';

const SAMPLE_ENTRY = {
  taskType: 'text-gen-short',
  backend: 'onnx-wasm',
  modelId: 'SmolLM2-135M',
  latencyMs: 250,
  success: true,
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('telemetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(localStorageData).forEach((k) => {
      delete localStorageData[k];
    });
    // Reset table-ensured state by re-importing (vi.resetModules not needed because mock resets)
    mockExec.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });
    // QNBS-v3: enable telemetry in tests so writes are exercised; production default is false
    setTelemetryEnabled(true);
  });

  describe('recordInferenceTelemetry', () => {
    it('is a no-op when telemetry is disabled', async () => {
      setTelemetryEnabled(false);
      await recordInferenceTelemetry(SAMPLE_ENTRY);
      expect(mockExec).not.toHaveBeenCalled();
      expect(localStorageData['worldscript-ai-telemetry']).toBeUndefined();
    });

    it('calls duckdbClient.exec when DuckDB is available', async () => {
      await recordInferenceTelemetry(SAMPLE_ENTRY);
      // First call creates table, second inserts
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai_telemetry'), [
        SAMPLE_ENTRY.taskType,
        SAMPLE_ENTRY.backend,
        SAMPLE_ENTRY.modelId,
        SAMPLE_ENTRY.latencyMs,
        SAMPLE_ENTRY.success,
      ]);
    });

    it('falls back to localStorage when DuckDB throws', async () => {
      mockExec.mockRejectedValue(new Error('DuckDB not ready'));
      await recordInferenceTelemetry(SAMPLE_ENTRY);
      const raw = localStorageData['worldscript-ai-telemetry'];
      expect(raw).toBeDefined();
      const entries = JSON.parse(raw!) as unknown[];
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getRecentTelemetry', () => {
    it('returns rows from DuckDB when available', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            task_type: 'embedding',
            backend: 'onnx-wasm',
            model_id: 'test',
            latency_ms: 100,
            success: true,
            timestamp: 0,
          },
        ],
      });
      const results = await getRecentTelemetry(10);
      expect(results).toHaveLength(1);
      expect(results[0]?.taskType).toBe('embedding');
    });

    it('falls back to localStorage when DuckDB query throws', async () => {
      mockQuery.mockRejectedValue(new Error('DuckDB not ready'));
      // Pre-populate localStorage
      localStorageData['worldscript-ai-telemetry'] = JSON.stringify([SAMPLE_ENTRY]);
      const results = await getRecentTelemetry(10);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('clearTelemetry', () => {
    it('clears DuckDB table and localStorage', async () => {
      localStorageData['worldscript-ai-telemetry'] = JSON.stringify([SAMPLE_ENTRY]);
      await clearTelemetry();
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ai_telemetry'));
      expect(localStorageData['worldscript-ai-telemetry']).toBeUndefined();
    });
  });
});
