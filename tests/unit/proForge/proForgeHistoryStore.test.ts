// @vitest-environment node
// QNBS-v3: node environment + fresh IDBFactory per test for full isolation (mirrors memory-bank test).

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineRun } from '../../../features/proForge/types';
import {
  _resetHistoryDbForTest,
  loadRunHistory,
  MAX_RUN_HISTORY,
  saveRunHistory,
} from '../../../services/proForge/proForgeHistoryStore';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  _resetHistoryDbForTest();
});

afterEach(() => {
  _resetHistoryDbForTest();
});

function run(id: string): PipelineRun {
  return {
    id,
    projectId: 'p1',
    label: id,
    config: {} as PipelineRun['config'],
    status: 'completed',
    activeStage: 'archived',
    stages: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    prePipelineSnapshotId: 'snap-1',
    traceLog: [],
  };
}

describe('proForgeHistoryStore', () => {
  it('returns an empty array when nothing is persisted', async () => {
    expect(await loadRunHistory('p1')).toEqual([]);
  });

  it('round-trips run history for a project', async () => {
    await saveRunHistory('p1', [run('a'), run('b')]);
    const loaded = await loadRunHistory('p1');
    expect(loaded.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('scopes history by project id', async () => {
    await saveRunHistory('p1', [run('a')]);
    await saveRunHistory('p2', [run('z')]);
    expect((await loadRunHistory('p2')).map((r) => r.id)).toEqual(['z']);
    expect((await loadRunHistory('p1')).map((r) => r.id)).toEqual(['a']);
  });

  it('caps stored history to MAX_RUN_HISTORY (most-recent-first)', async () => {
    const many = Array.from({ length: MAX_RUN_HISTORY + 5 }, (_, i) => run(`r${i}`));
    await saveRunHistory('p1', many);
    const loaded = await loadRunHistory('p1');
    expect(loaded).toHaveLength(MAX_RUN_HISTORY);
    expect(loaded[0]?.id).toBe('r0');
  });

  it('overwrites prior history for the same project', async () => {
    await saveRunHistory('p1', [run('old')]);
    await saveRunHistory('p1', [run('new')]);
    expect((await loadRunHistory('p1')).map((r) => r.id)).toEqual(['new']);
  });
});
