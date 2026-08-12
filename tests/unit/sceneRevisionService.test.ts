// @vitest-environment node
// QNBS-v3: node environment avoids jsdom's non-configurable indexedDB stub.
//          Fresh IDBFactory per test ensures complete isolation between tests.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function insertRawRevision(record: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('worldscript-revisions-db');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('scene-revisions', 'readwrite');
      transaction.objectStore('scene-revisions').put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Raw revision insert aborted'));
    };
    request.onerror = () => reject(request.error);
  });
}

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

  it('keeps retention bounded when concurrent saves target the same section', async () => {
    await saveRevision('sec1', { title: 'seed', content: 'seed' });
    await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        saveRevision('sec1', { title: `revision ${index}`, content: `content ${index}` }),
      ),
    );

    await expect(listRevisions('sec1')).resolves.toHaveLength(50);
  });

  it('opens the database connection only once for concurrent saves (single-flight)', async () => {
    // QNBS-v3 regression: getDb() only cached the connection after its own open resolved, so
    // concurrent callers each raced past the null check and opened a separate connection.
    const openSpy = vi.spyOn(indexedDB, 'open');
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        saveRevision('sec2', { title: `revision ${index}`, content: `content ${index}` }),
      ),
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('skips a future stored schema instead of interpreting it as v1, keeping other revisions readable', async () => {
    // QNBS-v3: listRevisions skips an unreadable revision (logged) instead of rejecting the whole call.
    await saveRevision('sec1', { title: 'known', content: 'known content' });
    await insertRawRevision({
      id: 'future-schema',
      sectionId: 'sec1',
      createdAt: Date.now(),
      schemaVersion: 2,
      payload: { title: 'future', content: 'must not decode as v1', wordCount: 6 },
    });

    const list = await listRevisions('sec1');
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('known');
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
