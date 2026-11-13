import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAnalyticsPersistenceAllowed } from '../../app/analyticsGate';
import type { RootState } from '../../app/store';
import { selectEnableDuckDbAnalytics } from '../../features/featureFlags/featureFlagsSlice';
import { recordInferenceTelemetry, setTelemetryEnabled } from '../../services/ai/telemetryService';
import { queryRagSimilarity } from '../../services/duckdb/duckdbAnalytics';
import {
  DUCKDB_ANALYTICS_AVAILABLE,
  DUCKDB_UNAVAILABLE_REASON,
} from '../../services/duckdb/duckdbAvailability';
import { duckdbClient } from '../../services/duckdb/duckdbClient';
import { HELP_CATALOG } from '../../services/help/helpCatalog';
import { retrieveContext } from '../../services/localRagService';
import { storageService } from '../../services/storageService';

const { mockEnsureDuckDbPool } = vi.hoisted(() => ({ mockEnsureDuckDbPool: vi.fn() }));
vi.mock('../../services/workerBusManager', () => ({
  ensureDuckDbPool: mockEnsureDuckDbPool,
  getWorkerBus: vi.fn(() => null),
}));
vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  duckdbRagWrite: vi.fn().mockResolvedValue(undefined),
  queryRagSimilarity: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/storageService', () => ({
  storageService: { saveRagVectors: vi.fn(), getRagVectors: vi.fn() },
}));

// #716, maintainer decision of 2026-11-13: v1.29.7 disables DuckDB analytics in a controlled way. Its boot never
// became ready in production while its worker still touched OPFS, so this build starts no worker at all.
describe('DuckDB analytics in this build (#716)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is off', () => {
    expect(DUCKDB_ANALYTICS_AVAILABLE).toBe(false);
  });

  it.each([
    ['init', () => duckdbClient.init()],
    ['query', () => duckdbClient.query('SELECT 1')],
    ['exec', () => duckdbClient.exec('CREATE TABLE t (x INTEGER)')],
    ['shutdown', () => duckdbClient.shutdown()],
  ] as const)(
    '%s is refused with the reason, before any worker pool exists',
    async (_kind, call) => {
      await expect(call()).resolves.toMatchObject({ ok: false, error: DUCKDB_UNAVAILABLE_REASON });
      expect(mockEnsureDuckDbPool).not.toHaveBeenCalled();
    },
  );

  it('the help leaves out the article that promises OPFS persistence', () => {
    const contentKeys = HELP_CATALOG.flatMap((category) =>
      category.articles.map((a) => a.contentKey),
    );
    expect(contentKeys).not.toContain('help.docs.duckdb.content');
    expect(contentKeys).toContain('help.docs.ragPipeline.content');
  });

  // Writer, consistency checker, Plot Board and ProForge pass the stored flag as useDuckDb; context must not vanish.
  it('RAG retrieval that asks for DuckDB ranks from the IDB index instead', async () => {
    vi.mocked(storageService.getRagVectors).mockResolvedValue([
      {
        id: 's1:0',
        sectionId: 's1',
        chunkIndex: 0,
        text: 'The hero arrived at dawn.',
        vector: new Array(64).fill(0.1),
        indexedAt: Date.now(),
      },
    ]);

    const chunks = await retrieveContext(
      'p1',
      'hero',
      5,
      'lexical',
      new Float32Array(64).fill(0.5),
      true,
    );

    expect(queryRagSimilarity).not.toHaveBeenCalled();
    expect(chunks.map((chunk) => chunk.text)).toContain('The hero arrived at dawn.');
  });

  // App.tsx enables telemetry from the stored flag; telemetry belongs to DuckDB analytics, so it stays off here.
  it('collects no AI telemetry, even when the app enables it', async () => {
    window.localStorage.removeItem('worldscript-ai-telemetry');
    const exec = vi.spyOn(duckdbClient, 'exec');
    setTelemetryEnabled(true);
    await recordInferenceTelemetry({
      taskType: 'text-gen-short',
      backend: 'onnx-wasm',
      modelId: 'm',
      latencyMs: 1,
      success: true,
      timestamp: 0,
    });
    expect(exec).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('worldscript-ai-telemetry')).toBeNull();
    exec.mockRestore();
  });

  it('reads a stored flag as off, so nothing boots DuckDB or persists analytics', () => {
    const state = {
      featureFlags: { enableDuckDbAnalytics: true },
      settings: { privacy: { analyticsEnabled: true } },
    } as unknown as RootState;

    expect(selectEnableDuckDbAnalytics(state)).toBe(false);
    expect(isAnalyticsPersistenceAllowed(state)).toBe(false);
  });
});
