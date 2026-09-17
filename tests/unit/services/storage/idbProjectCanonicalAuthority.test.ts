// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-functional indexedDB stub from tests/setup.ts.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DATA_STORE } from '../../../../services/dbConstants';
import { IdbProjectCanonicalAuthority } from '../../../../services/storage/idbProjectCanonicalAuthority';
import {
  clearIdbEncryptionKey,
  initIdbEncryption,
} from '../../../../services/storage/storageEncryptionService';

// QNBS-v3: protected getObjectStore() is only reachable within the class hierarchy at compile time; tests reach across the boundary the same way idbStoreEncryption.test.ts already does.
type StoreWithObjectStoreAccess = {
  getObjectStore: (storeName: string, mode: IDBTransactionMode) => Promise<IDBObjectStore>;
};

const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

afterEach(() => {
  clearIdbEncryptionKey();
});

function baseProjectPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: 'My Story',
    logline: 'A logline.',
    author: 'Author',
    manuscript: 'Once upon a time...',
    outline: 'An opaque, Core-unmodeled outline value.',
    characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    worlds: { ids: [], entities: {} },
    ...overrides,
  };
}

/** Seeds the raw 'project' IDB record directly, bypassing the canonical authority's own admission/commit path (simulates the existing, non-fenced saveSlice path or an old cached build). */
async function seedProjectRecord(
  authority: IdbProjectCanonicalAuthority,
  value: unknown,
): Promise<void> {
  const store = await (authority as unknown as StoreWithObjectStoreAccess).getObjectStore(
    APP_DATA_STORE,
    'readwrite',
  );
  const transaction = store.transaction;
  await new Promise<void>((resolve, reject) => {
    store.put(value, 'project');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('seed transaction aborted'));
  });
}

describe('IdbProjectCanonicalAuthority#loadCanonicalProjectAdmission', () => {
  it('returns ABSENT when no project record exists', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({ status: 'ABSENT' });
  });

  it('returns CURRENT for a valid schema-current record and bootstraps the generation record', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ isPresentShape: false });
    expect(JSON.parse(admission.currentRaw)).toMatchObject({ title: 'My Story' });

    // QNBS-v3: a second load must observe the SAME generation the bootstrap established.
    const second = await authority.loadCanonicalProjectAdmission();
    expect(second).toEqual(admission);
  });

  it('recognizes the {present: {data}} redux-undo envelope shape', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { present: { data: baseProjectPayload() } });

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ isPresentShape: true });
  });

  it('never admits a FUTURE document for editable write authority', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload({ schemaVersion: 999 }) });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'FUTURE',
    });
  });

  it('never admits a LEGACY_UNVERSIONED document for editable write authority', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const { schemaVersion: _schemaVersion, ...legacy } = baseProjectPayload();
    await seedProjectRecord(authority, { data: legacy });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'LEGACY_UNVERSIONED',
    });
  });

  it('never admits a malformed envelope for editable write authority', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, 'not an object at all');

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'MALFORMED',
    });
  });

  it('never admits a record object with neither a data nor a present.data envelope member', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { unrelated: 'value' });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'MALFORMED',
    });
  });

  it('reports GENERATION_CONTRADICTION when a migrated project is superseded by a stale legacy-shaped write', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');

    // QNBS-v3: simulates an old cached build resaving its own legacy-shaped copy directly, bypassing the canonical authority entirely (contract §2.7).
    const { schemaVersion: _schemaVersion, ...legacy } = baseProjectPayload();
    await seedProjectRecord(authority, { data: legacy });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'GENERATION_CONTRADICTION',
      classification: 'LEGACY_UNVERSIONED',
    });
  });
});

describe('IdbProjectCanonicalAuthority#commitCanonicalProjectEdit', () => {
  it('commits an owned field edit and durably persists it', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');

    const reloaded = await authority.loadCanonicalProjectAdmission();
    expect(reloaded.status).toBe('CURRENT');
    if (reloaded.status !== 'CURRENT') return;
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({ title: 'Renamed Story' });
    if (result.status === 'COMMITTED') expect(reloaded.generation).toBe(result.generation);
  });

  it('preserves an opaque top-level field across a canonical commit', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    const reloaded = await authority.loadCanonicalProjectAdmission();
    if (reloaded.status !== 'CURRENT') throw new Error('expected CURRENT');
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({
      outline: 'An opaque, Core-unmodeled outline value.',
    });
  });

  it('fails closed (CONFLICT) when the source changed after the caller read its expected generation', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const staleAdmission = await authority.loadCanonicalProjectAdmission();
    if (staleAdmission.status !== 'CURRENT') throw new Error('expected CURRENT');

    // QNBS-v3: a second, independent commit lands first -- staleAdmission.generation is now stale.
    await authority.commitCanonicalProjectEdit({
      expectedGeneration: staleAdmission.generation,
      edit: { fields: { title: 'Someone else already renamed this' } },
    });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: staleAdmission.generation,
      edit: { fields: { logline: 'A different logline.' } },
    });

    expect(result.status).toBe('CONFLICT');
    const reloaded = await authority.loadCanonicalProjectAdmission();
    if (reloaded.status !== 'CURRENT') throw new Error('expected CURRENT');
    // QNBS-v3: the rejected edit must never have landed -- the winning commit's title stands.
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({
      title: 'Someone else already renamed this',
      logline: 'A logline.',
    });
  });

  it('preserves opaque data across repeated save/reload cycles without progressive normalization or loss', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });

    for (const title of ['Renamed Once', 'Renamed Twice', 'Renamed Thrice']) {
      const admission = await authority.loadCanonicalProjectAdmission();
      if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
      const result = await authority.commitCanonicalProjectEdit({
        expectedGeneration: admission.generation,
        edit: { fields: { title } },
      });
      expect(result.status).toBe('COMMITTED');
    }

    const final = await authority.loadCanonicalProjectAdmission();
    if (final.status !== 'CURRENT') throw new Error('expected CURRENT');
    expect(JSON.parse(final.currentRaw)).toMatchObject({
      title: 'Renamed Thrice',
      outline: 'An opaque, Core-unmodeled outline value.',
    });
  });

  it('refuses to commit against a non-CURRENT document', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload({ schemaVersion: 999 }) });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: 'irrelevant',
      edit: { fields: { title: 'Should never land' } },
    });

    expect(result).toEqual({ status: 'NOT_ADMITTED_FOR_WRITE', classification: 'FUTURE' });
  });

  it('refuses to commit against a GENERATION_CONTRADICTION document', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    await authority.loadCanonicalProjectAdmission(); // establishes the migrated companion record
    const { schemaVersion: _schemaVersion, ...legacy } = baseProjectPayload();
    await seedProjectRecord(authority, { data: legacy });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: 'irrelevant',
      edit: { fields: { title: 'Should never land' } },
    });

    expect(result).toEqual({
      status: 'NOT_ADMITTED_FOR_WRITE',
      classification: 'GENERATION_CONTRADICTION:LEGACY_UNVERSIONED',
    });
  });

  it('refuses to commit when no project record exists yet', async () => {
    const authority = new IdbProjectCanonicalAuthority();

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: 'irrelevant',
      edit: { fields: { title: 'Should never land' } },
    });

    expect(result).toEqual({ status: 'NOT_ADMITTED_FOR_WRITE', classification: 'ABSENT' });
  });

  it('round-trips a commit correctly when at-rest encryption is active', async () => {
    await initIdbEncryption('test-pass');
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Under Encryption' } },
    });
    expect(result.status).toBe('COMMITTED');

    const reloaded = await authority.loadCanonicalProjectAdmission();
    if (reloaded.status !== 'CURRENT') throw new Error('expected CURRENT');
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({ title: 'Renamed Under Encryption' });
  });
});
