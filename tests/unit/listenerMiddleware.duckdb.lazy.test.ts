import { describe, expect, it, vi } from 'vitest';

const loadDuckdbAnalytics = vi.fn();
const loadLocalRagService = vi.fn();

vi.mock('../../services/duckdb/duckdbListenerLoader', () => ({
  loadDuckdbAnalytics,
  loadDuckdbMigration: vi.fn(),
  loadRagVectorMigration: vi.fn(),
  loadLocalRagService,
}));

describe('listenerMiddleware duckdb lazy imports', () => {
  it('does not statically import duckdbAnalytics at module load', async () => {
    loadDuckdbAnalytics.mockResolvedValue({
      duckdbDualWrite: vi.fn().mockResolvedValue(undefined),
      withDuckDbRetry: vi.fn((fn: () => Promise<void>) => fn()),
      duckdbCodexWrite: vi.fn(),
    });
    loadLocalRagService.mockResolvedValue({
      rebuildHybridRagIndex: vi.fn().mockResolvedValue(0),
    });

    const mod = await import('../../app/listenerMiddleware');
    expect(mod.listenerMiddleware).toBeDefined();
    expect(loadDuckdbAnalytics).not.toHaveBeenCalled();
  });
});
