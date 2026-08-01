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
import { _resetPassphraseSentinelForTest } from '../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../services/storage/storageEncryptionService';

const DB_NAME = 'worldscript-revisions-db';
const STORE = 'scene-revisions';

async function readRawRevision(id: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawRevision(record: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

beforeEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  // Fresh IDB instance per test — avoids record leak between tests
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
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

  it('encrypts all content-bearing fields in the raw IndexedDB record', async () => {
    const canary = 'SCENE_CONTENT_CANARY_28f0';
    const titleCanary = 'SCENE_TITLE_CANARY_18a7';
    await setupIdbEncryption('revision-passphrase');

    const revision = await saveRevision(
      'sec-encrypted',
      { title: titleCanary, content: canary },
      'PRIVATE_LABEL_CANARY',
      'PRIVATE_AUTHOR_CANARY',
    );
    const raw = (await readRawRevision(revision.id)) as Record<string, unknown>;

    expect(raw['id']).toBe(revision.id);
    expect(raw['sectionId']).toBe('sec-encrypted');
    expect(isSecureRecordEnvelope(raw['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain(canary);
    expect(JSON.stringify(raw)).not.toContain(titleCanary);
    expect(JSON.stringify(raw)).not.toContain('PRIVATE_LABEL_CANARY');
    expect(JSON.stringify(raw)).not.toContain('PRIVATE_AUTHOR_CANARY');
    await expect(listRevisions('sec-encrypted')).resolves.toEqual([revision]);
  });

  it('rejects reads and writes while configured encryption is locked', async () => {
    await setupIdbEncryption('revision-passphrase');
    await saveRevision('sec-locked', { title: 'Locked', content: 'Sensitive' });
    clearIdbEncryptionKey();

    await expect(listRevisions('sec-locked')).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(
      saveRevision('sec-locked', { title: 'New', content: 'Must not persist plaintext' }),
    ).rejects.toBeInstanceOf(SecureRecordLockedError);
  });

  it('lazily rewrites a legacy plaintext revision after unlock', async () => {
    const seed = await saveRevision('seed', { title: 'Seed', content: 'Seed' });
    await deleteRevision(seed.id);
    const legacy = {
      id: 'legacy-revision',
      sectionId: 'sec-legacy',
      createdAt: 123,
      title: 'LEGACY_TITLE_CANARY',
      content: 'LEGACY_CONTENT_CANARY',
      wordCount: 2,
      label: 'LEGACY_LABEL_CANARY',
    };
    await writeRawRevision(legacy);
    await setupIdbEncryption('revision-passphrase');

    await expect(listRevisions('sec-legacy')).resolves.toEqual([legacy]);
    const migrated = (await readRawRevision(legacy.id)) as Record<string, unknown>;
    expect(isSecureRecordEnvelope(migrated['payload'])).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_CONTENT_CANARY');
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_TITLE_CANARY');
  });

  it('fails closed when an encrypted revision is corrupted', async () => {
    await setupIdbEncryption('revision-passphrase');
    const revision = await saveRevision('sec-corrupt', {
      title: 'Corrupt',
      content: 'CORRUPTION_CANARY',
    });
    const raw = (await readRawRevision(revision.id)) as Record<string, unknown>;
    const payload = raw['payload'];
    if (!isSecureRecordEnvelope(payload)) throw new Error('Expected encrypted revision');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRawRevision({ ...raw, payload: { ...payload, ciphertext } });

    await expect(listRevisions('sec-corrupt')).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });

  it('_resetDbForTest allows re-initialization', async () => {
    _resetDbForTest();
    const rev = await saveRevision('sec1', { title: 'T', content: 'C' });
    expect(rev.id).toBeTruthy();
  });
});
