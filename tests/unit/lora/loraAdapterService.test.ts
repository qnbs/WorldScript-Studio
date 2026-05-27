// @vitest-environment node
/**
 * Tests for services/loraAdapterService.ts — v2 additions.
 * QNBS-v3: Extends existing tests/unit/loraAdapterService.test.ts with new IDB stores
 *          (lora-datasets, lora-runs, lora-active) added in DB_VERSION 2.
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

import {
  activateAdapter,
  deactivateAdapter,
  getActiveAdapter,
  type LoraAdapterMeta,
  listAdapterVersions,
  listDatasetEntries,
  listTrainingRuns,
  type StoredDatasetEntry,
  type StoredTrainingRun,
  saveAdapter,
  saveDatasetEntries,
  saveTrainingRun,
  versionAdapter,
} from '../../../services/loraAdapterService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_META: LoraAdapterMeta = {
  id: 'a1',
  name: 'Style v1',
  description: 'Test adapter',
  modelCompatibility: 'llama-3.2-7b',
  scale: 1,
  fileSizeBytes: 256,
  createdAt: 1716000000000,
  projectId: 'proj-1',
  version: 1,
};

const mockEntry = (id: string, projectId = 'proj-1'): StoredDatasetEntry => ({
  id,
  projectId,
  instruction: 'Continue the scene',
  input: '',
  output: 'The keeper watched the horizon darken.',
  source: 'extracted',
  qualityScore: 0.75,
  wordCount: 7,
  createdAt: Date.now(),
});

const mockRun = (id: string, projectId = 'proj-1'): StoredTrainingRun => ({
  id,
  projectId,
  baseModelId: 'llama-3.2-7b',
  presetId: 'writer-style-light',
  status: 'completed',
  progressPercent: 100,
  currentEpoch: 1,
  totalEpochs: 1,
  currentLoss: 0.42,
  lossHistory: [1.2, 0.8, 0.42],
  startedAt: 1716000000000,
  completedAt: 1716003600000,
});

// ---------------------------------------------------------------------------
// activateAdapter / deactivateAdapter / getActiveAdapter
// ---------------------------------------------------------------------------

describe('activateAdapter + getActiveAdapter', () => {
  it('returns null when no adapter has been activated', async () => {
    expect(await getActiveAdapter()).toBeNull();
  });

  it('marks the correct adapter as active and stores it', async () => {
    await saveAdapter(BASE_META, new ArrayBuffer(4));
    await saveAdapter({ ...BASE_META, id: 'a2', name: 'Style v2' }, new ArrayBuffer(4));

    await activateAdapter('a1');
    const active = await getActiveAdapter();
    expect(active?.id).toBe('a1');
    expect(active?.isActive).toBe(true);
  });

  it('marks other adapters as inactive when activating one', async () => {
    await saveAdapter(BASE_META, new ArrayBuffer(4));
    await saveAdapter({ ...BASE_META, id: 'a2', name: 'Style v2' }, new ArrayBuffer(4));

    await activateAdapter('a1');
    await activateAdapter('a2');
    const active = await getActiveAdapter();
    expect(active?.id).toBe('a2');
  });
});

describe('deactivateAdapter', () => {
  it('clears the active adapter', async () => {
    await saveAdapter(BASE_META, new ArrayBuffer(4));
    await activateAdapter('a1');
    expect((await getActiveAdapter())?.id).toBe('a1');

    await deactivateAdapter();
    expect(await getActiveAdapter()).toBeNull();
  });

  it('does not throw when no adapter is active', async () => {
    await expect(deactivateAdapter()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// versionAdapter / listAdapterVersions
// ---------------------------------------------------------------------------

describe('versionAdapter', () => {
  it('creates a versioned copy with incremented version number', async () => {
    await saveAdapter(BASE_META, new ArrayBuffer(4));
    const versioned = await versionAdapter('a1');

    expect(versioned.version).toBe(2);
    expect(versioned.baseVersionId).toBe('a1');
    expect(versioned.id).toContain('a1_v2');
    expect(versioned.isActive).toBe(false);
  });

  it('throws when adapter id does not exist', async () => {
    await expect(versionAdapter('nonexistent')).rejects.toThrow();
  });
});

describe('listAdapterVersions', () => {
  it('returns original adapter plus all versioned copies', async () => {
    await saveAdapter(BASE_META, new ArrayBuffer(4));
    await versionAdapter('a1');
    await versionAdapter('a1');

    const versions = await listAdapterVersions('a1');
    expect(versions.length).toBeGreaterThanOrEqual(2);
    // Should be sorted by version asc
    expect(versions[0]!.id).toBe('a1');
  });

  it('returns empty array for unknown baseId', async () => {
    const versions = await listAdapterVersions('unknown-id');
    expect(versions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// saveDatasetEntries / listDatasetEntries
// ---------------------------------------------------------------------------

describe('saveDatasetEntries + listDatasetEntries', () => {
  it('returns empty array for unknown project', async () => {
    const entries = await listDatasetEntries('unknown');
    expect(entries).toEqual([]);
  });

  it('saves and retrieves entries by projectId', async () => {
    const entries = [mockEntry('e1'), mockEntry('e2')];
    await saveDatasetEntries(entries);
    const stored = await listDatasetEntries('proj-1');
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('does not return entries from other projects', async () => {
    await saveDatasetEntries([mockEntry('e1', 'proj-a'), mockEntry('e2', 'proj-b')]);
    const stored = await listDatasetEntries('proj-a');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('e1');
  });
});

// ---------------------------------------------------------------------------
// saveTrainingRun / listTrainingRuns
// ---------------------------------------------------------------------------

describe('saveTrainingRun + listTrainingRuns', () => {
  it('returns empty array for unknown project', async () => {
    const runs = await listTrainingRuns('unknown');
    expect(runs).toEqual([]);
  });

  it('persists and retrieves runs by projectId', async () => {
    await saveTrainingRun(mockRun('r1'));
    await saveTrainingRun(mockRun('r2'));
    const stored = await listTrainingRuns('proj-1');
    expect(stored).toHaveLength(2);
    expect(stored[0]!.status).toBe('completed');
  });

  it('does not return runs from other projects', async () => {
    await saveTrainingRun(mockRun('r1', 'proj-x'));
    await saveTrainingRun(mockRun('r2', 'proj-y'));
    expect(await listTrainingRuns('proj-x')).toHaveLength(1);
  });

  it('upserts a run by id', async () => {
    await saveTrainingRun(mockRun('r1'));
    await saveTrainingRun({ ...mockRun('r1'), status: 'failed', progressPercent: 42 });
    const runs = await listTrainingRuns('proj-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.progressPercent).toBe(42);
  });
});
