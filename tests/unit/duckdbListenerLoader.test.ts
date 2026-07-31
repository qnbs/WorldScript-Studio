import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  duckdbDualWrite: vi.fn(),
  withDuckDbRetry: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock('../../services/duckdb/duckdbMigration', () => ({
  runIfNeeded: vi.fn(),
}));

vi.mock('../../services/duckdb/ragVectorMigration', () => ({
  runRagVectorMigration: vi.fn(),
}));

vi.mock('../../services/duckdb/codexExcerptEncryptionMigration', () => ({
  runCodexExcerptEncryptionMigration: vi.fn(),
}));

vi.mock('../../services/localRagService', () => ({
  rebuildHybridRagIndex: vi.fn(),
}));

import {
  loadCodexExcerptEncryptionMigration,
  loadDuckdbAnalytics,
  loadDuckdbMigration,
  loadLocalRagService,
  loadRagVectorMigration,
} from '../../services/duckdb/duckdbListenerLoader';

describe('duckdbListenerLoader', () => {
  it('loadDuckdbAnalytics returns duckdb analytics module', async () => {
    const mod = await loadDuckdbAnalytics();
    expect(mod.duckdbDualWrite).toBeDefined();
    expect(mod.withDuckDbRetry).toBeDefined();
  });

  it('loadDuckdbMigration returns migration module', async () => {
    const mod = await loadDuckdbMigration();
    expect(mod.runIfNeeded).toBeDefined();
  });

  it('loadRagVectorMigration returns rag migration module', async () => {
    const mod = await loadRagVectorMigration();
    expect(mod.runRagVectorMigration).toBeDefined();
  });

  it('loadCodexExcerptEncryptionMigration returns codex excerpt encryption migration module', async () => {
    const mod = await loadCodexExcerptEncryptionMigration();
    expect(mod.runCodexExcerptEncryptionMigration).toBeDefined();
  });

  it('loadLocalRagService returns local RAG module', async () => {
    const mod = await loadLocalRagService();
    expect(mod.rebuildHybridRagIndex).toBeDefined();
  });
});
