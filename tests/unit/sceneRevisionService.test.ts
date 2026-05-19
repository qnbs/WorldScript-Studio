// @vitest-environment node
// QNBS-v3: node environment avoids jsdom's non-configurable indexedDB stub.
//          Fresh IDBFactory per test ensures complete isolation between tests.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDbForTest,
  deleteRevision,
  listRevisions,
  saveRevision,
} from '../../services/sceneRevisionService';

beforeEach(() => {
  // Fresh IDB instance per test — avoids record leak between tests
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  _resetDbForTest();
});

afterEach(() => {
  _resetDbForTest();
});

describe('sceneRevisionService', () => {
  it('saveRevision returns a revision with correct fields', async () => {
    const revision = await saveRevision('sec1', { title: 'Scene 1', content: 'Hello world' });
    expect(revision.sectionId).toBe('sec1');
    expect(revision.title).toBe('Scene 1');
    expect(revision.wordCount).toBe(2);
    expect(revision.id).toMatch(/^rev-/);
  });

  it('saveRevision includes optional label when provided', async () => {
    const revision = await saveRevision('sec1', { title: 'T', content: 'C' }, 'Draft 2');
    expect(revision.label).toBe('Draft 2');
  });

  it('saveRevision does not set label property when undefined', async () => {
    const revision = await saveRevision('sec1', { title: 'T', content: 'C' });
    expect('label' in revision).toBe(false);
  });

  it('saveRevision includes optional authorName when provided', async () => {
    const revision = await saveRevision('sec1', { title: 'T', content: 'C' }, undefined, 'Alice');
    expect(revision.authorName).toBe('Alice');
  });

  it('listRevisions returns saved revision', async () => {
    await saveRevision('sec1', { title: 'A', content: 'aaa' });
    const list = await listRevisions('sec1');
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('A');
  });

  it('listRevisions returns newest-first order', async () => {
    await saveRevision('sec1', { title: 'First', content: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    await saveRevision('sec1', { title: 'Second', content: 'second' });
    const list = await listRevisions('sec1');
    expect(list).toHaveLength(2);
    expect(list[0]?.title).toBe('Second');
  });

  it('listRevisions returns empty for unknown section', async () => {
    const list = await listRevisions('no-such-section');
    expect(list).toHaveLength(0);
  });

  it('deleteRevision removes the record', async () => {
    const rev = await saveRevision('sec1', { title: 'T', content: 'C' });
    await deleteRevision(rev.id);
    const list = await listRevisions('sec1');
    expect(list).toHaveLength(0);
  });

  it('saveRevision calculates wordCount correctly', async () => {
    const rev = await saveRevision('sec1', { title: 'T', content: 'one two three four five' });
    expect(rev.wordCount).toBe(5);
  });

  it('saveRevision handles empty content', async () => {
    const rev = await saveRevision('sec1', { title: 'T', content: '' });
    expect(rev.wordCount).toBe(0);
  });

  it('listRevisions isolates by sectionId', async () => {
    await saveRevision('sec1', { title: 'T', content: 'C' });
    await saveRevision('sec2', { title: 'T2', content: 'C2' });
    const list = await listRevisions('sec1');
    expect(list).toHaveLength(1);
    expect(list[0]?.sectionId).toBe('sec1');
  });

  it('createdAt is a number timestamp', async () => {
    const rev = await saveRevision('sec1', { title: 'T', content: 'C' });
    expect(typeof rev.createdAt).toBe('number');
    expect(rev.createdAt).toBeGreaterThan(0);
  });

  it('_resetDbForTest allows re-initialization', async () => {
    _resetDbForTest();
    const rev = await saveRevision('sec1', { title: 'T', content: 'C' });
    expect(rev.id).toBeTruthy();
  });
});
