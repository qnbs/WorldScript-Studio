// @vitest-environment node
// QNBS-v3: node environment + global.indexedDB = fake-indexeddb avoids jsdom's stub.
//          Module imported once — singleton dbPromise reused; tests clean own records via removeProjectIndex.
import { indexedDB as fakeIdb, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

global.indexedDB = fakeIdb;
global.IDBKeyRange = IDBKeyRange;

import type { ProjectData } from '../../features/project/projectSlice';
import {
  indexProject,
  listIndexedProjects,
  removeProjectIndex,
} from '../../services/crossProjectIndexService';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_IDS = ['proj-1', 'proj-2'];

function makeProjectData(overrides: Partial<Record<string, unknown>> = {}): ProjectData {
  return {
    id: 'proj-1',
    title: 'My Novel',
    logline: 'A hero saves the world.',
    manuscript: [
      {
        id: 's1',
        title: 'Chapter 1',
        content: 'Once upon a time there were three words.',
      },
    ],
    characters: { ids: [], entities: {} },
    outline: { id: 'outline-1', sections: [] },
    tags: [],
    worldBuilding: { id: 'wb-1', entries: [] },
    ...overrides,
  } as unknown as ProjectData;
}

// Clear known test records before each test to avoid cross-test state pollution.
beforeEach(async () => {
  for (const id of TEST_IDS) {
    await removeProjectIndex(id).catch(() => {});
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('crossProjectIndexService', () => {
  it('indexProject persists a record readable by listIndexedProjects', async () => {
    await indexProject('proj-1', makeProjectData());
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found).toBeDefined();
    expect(found?.title).toBe('My Novel');
    expect(found?.logline).toBe('A hero saves the world.');
  });

  it('indexProject stores character names from normalized structure', async () => {
    const data = makeProjectData({
      characters: {
        ids: ['c1', 'c2'],
        entities: {
          c1: { id: 'c1', name: 'Alice' },
          c2: { id: 'c2', name: 'Bob' },
        },
      },
    });
    await indexProject('proj-1', data);
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.characterNames).toContain('Alice');
    expect(found?.characterNames).toContain('Bob');
  });

  it('indexProject counts manuscript words', async () => {
    // "Once upon a time there were three words." = 8 words
    await indexProject('proj-1', makeProjectData());
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.manuscriptWordCount).toBe(8);
  });

  it('listIndexedProjects returns records sorted by lastIndexed descending', async () => {
    await indexProject('proj-1', makeProjectData({ title: 'First' }));
    await new Promise((r) => setTimeout(r, 5));
    await indexProject('proj-2', makeProjectData({ id: 'proj-2', title: 'Second' }));

    const results = await listIndexedProjects();
    const p1 = results.find((r) => r.projectId === 'proj-1');
    const p2 = results.find((r) => r.projectId === 'proj-2');
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    // proj-2 was indexed later so should appear first (higher lastIndexed)
    const p1Idx = results.indexOf(p1!);
    const p2Idx = results.indexOf(p2!);
    expect(p2Idx).toBeLessThan(p1Idx);
  });

  it('removeProjectIndex deletes the record', async () => {
    await indexProject('proj-1', makeProjectData());
    await removeProjectIndex('proj-1');
    const results = await listIndexedProjects();
    expect(results.find((r) => r.projectId === 'proj-1')).toBeUndefined();
  });

  it('indexProject truncates title to 256 chars and logline to 512 chars', async () => {
    const data = makeProjectData({
      title: 'T'.repeat(300),
      logline: 'L'.repeat(600),
    });
    await indexProject('proj-1', data);
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.title.length).toBe(256);
    expect(found?.logline.length).toBe(512);
  });

  it('indexProject sets lastIndexed to approximately now', async () => {
    const before = Date.now();
    await indexProject('proj-1', makeProjectData());
    const after = Date.now();
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.lastIndexed).toBeGreaterThanOrEqual(before);
    expect(found?.lastIndexed).toBeLessThanOrEqual(after);
  });
});
