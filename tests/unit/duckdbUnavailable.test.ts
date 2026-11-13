import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAnalyticsPersistenceAllowed } from '../../app/analyticsGate';
import type { RootState } from '../../app/store';
import { selectEnableDuckDbAnalytics } from '../../features/featureFlags/featureFlagsSlice';
import {
  DUCKDB_ANALYTICS_AVAILABLE,
  DUCKDB_UNAVAILABLE_REASON,
} from '../../services/duckdb/duckdbAvailability';
import { duckdbClient } from '../../services/duckdb/duckdbClient';
import { HELP_CATALOG } from '../../services/help/helpCatalog';

const { mockEnsureDuckDbPool } = vi.hoisted(() => ({ mockEnsureDuckDbPool: vi.fn() }));
vi.mock('../../services/workerBusManager', () => ({
  ensureDuckDbPool: mockEnsureDuckDbPool,
  getWorkerBus: vi.fn(() => null),
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

  it('reads a stored flag as off, so nothing boots DuckDB or persists analytics', () => {
    const state = {
      featureFlags: { enableDuckDbAnalytics: true },
      settings: { privacy: { analyticsEnabled: true } },
    } as unknown as RootState;

    expect(selectEnableDuckDbAnalytics(state)).toBe(false);
    expect(isAnalyticsPersistenceAllowed(state)).toBe(false);
  });
});
