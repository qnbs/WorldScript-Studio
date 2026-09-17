// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-functional indexedDB stub from tests/setup.ts.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_DATA_STORE } from '../../../../services/dbConstants';
import { IdbProjectCanonicalAuthority } from '../../../../services/storage/idbProjectCanonicalAuthority';
import * as storageEncryptionService from '../../../../services/storage/storageEncryptionService';
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

  it('returns CURRENT for a valid schema-current record, read-only (no write)', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const seeded = { data: baseProjectPayload() };
    await seedProjectRecord(authority, seeded);

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ isPresentShape: false, originalEnvelope: seeded });
    expect(JSON.parse(admission.currentRaw)).toMatchObject({ title: 'My Story' });

    // QNBS-v3: a read-only admission call must never write anything -- a second load observes identical results.
    const second = await authority.loadCanonicalProjectAdmission();
    expect(second).toEqual(admission);
  });

  it('recognizes the {present: {data}} redux-undo envelope shape', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const seeded = { present: { data: baseProjectPayload() } };
    await seedProjectRecord(authority, seeded);

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ isPresentShape: true, originalEnvelope: seeded });
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
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    // QNBS-v3: an actual commit is what establishes the "migrated" companion marker now -- a read-only admission never writes anything.
    const committed = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Confirmed canonical' } },
    });
    expect(committed.status).toBe('COMMITTED');

    // QNBS-v3: simulates an old cached build resaving its own legacy-shaped copy directly, bypassing the canonical authority entirely (contract §2.7).
    const { schemaVersion: _schemaVersion, ...legacy } = baseProjectPayload();
    await seedProjectRecord(authority, { data: legacy });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'GENERATION_CONTRADICTION',
      classification: 'LEGACY_UNVERSIONED',
    });
  });

  it('preserves opaque envelope siblings (e.g. redux-undo past/future) across a canonical commit', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      past: ['snapshot-1'],
      present: { data: baseProjectPayload() },
      future: [],
      _latestUnfiltered: { data: baseProjectPayload() },
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });
    expect(result.status).toBe('COMMITTED');

    const store = await (authority as unknown as StoreWithObjectStoreAccess).getObjectStore(
      APP_DATA_STORE,
      'readonly',
    );
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = store.get('project');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored).toMatchObject({ past: ['snapshot-1'], future: [] });
  });

  it('never throws when a stored payload cannot be JSON-serialized, classifying it MALFORMED instead', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    // QNBS-v3: compressData/decompressData preserve non-JSON-safe values (e.g. BigInt) unchanged for small, unencrypted payloads -- JSON.stringify on read must fail closed, not throw uncaught.
    await seedProjectRecord(authority, { data: { schemaVersion: 1n } });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'MALFORMED',
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

  it('fails closed when a legacy (non-fenced) writer changes the raw project bytes during the async encrypt window, after the fresh-read generation check already passed', async () => {
    // QNBS-v3 regression: the fence must compare raw project bytes inside the write transaction, not
    // rely solely on the companion generation record (which a legacy writer never updates) or on the
    // generation check performed before this async window opened.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        // QNBS-v3: simulates a legacy write landing during the async key-resolve/encrypt window, strictly after commitOwnedProjectEdit's own generation check already passed against the fresh read.
        await seedProjectRecord(authority, { data: baseProjectPayload({ title: 'Raced In' }) });
        return null;
      });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Should not land' } },
    });

    spy.mockRestore();
    expect(result.status).toBe('CONFLICT');
    const reloaded = await authority.loadCanonicalProjectAdmission();
    if (reloaded.status !== 'CURRENT') throw new Error('expected CURRENT');
    // QNBS-v3: the raced-in legacy write must survive untouched -- the rejected edit never lands.
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({ title: 'Raced In' });
  });

  it('detects a concurrent change to a Map-valued opaque field that JSON.stringify cannot distinguish', async () => {
    // QNBS-v3 regression: JSON.stringify serializes every Map as "{}" regardless of its entries, so
    // a JSON.stringify-based raw-bytes comparison would wrongly treat two DIFFERENT Maps as equal --
    // the fence must use a type-aware structural comparison instead.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: { ...baseProjectPayload(), meta: new Map([['a', 1]]) },
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        // QNBS-v3: same JSON-visible content but a genuinely different Map -- JSON.stringify collapses both Maps to identical text, so even commitOwnedProjectEdit's own generation check can't see this.
        await seedProjectRecord(authority, {
          data: { ...baseProjectPayload(), meta: new Map([['a', 2]]) },
        });
        return null;
      });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Should not land' } },
    });

    spy.mockRestore();
    expect(result.status).toBe('CONFLICT');
  });

  it('does not false-positive CONFLICT when a Set contains structurally-identical objects at different references', async () => {
    // QNBS-v3 regression: comparing Set/Map elements via .has() uses reference equality, so IndexedDB
    // structured-clone re-reading the SAME unchanged content at a NEW object identity would wrongly
    // report a conflict; the fence must compare Set/Map elements structurally instead.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: { ...baseProjectPayload(), tags: new Set([{ name: 'fantasy' }]) },
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');
  });

  it('detects a change when structured-clone values of genuinely different exotic types occupy the same field', async () => {
    // QNBS-v3 regression: Date and RegExp instances both have zero own enumerable keys, so a
    // plain-object fallback comparison would wrongly treat a Date-vs-RegExp mismatch as two equal
    // empty objects; the fence must require both values to be genuine plain objects for that path.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: { ...baseProjectPayload(), marker: new Date('2026-01-01') },
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        await seedProjectRecord(authority, {
          data: { ...baseProjectPayload(), marker: /raced-in/ },
        });
        return null;
      });

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Should not land' } },
    });

    spy.mockRestore();
    expect(result.status).toBe('CONFLICT');
  });

  it('does not crash on a cyclic value in an opaque envelope sibling reachable through the raw-bytes fence', async () => {
    // QNBS-v3 regression: a cycle inside `data` itself would already fail JSON.stringify during
    // admission (classified MALFORMED) -- but a cycle in a SIBLING of `data` (e.g. an opaque
    // envelope member this classifier never stringifies) survives admission as CURRENT and still
    // reaches rawStoredValuesEqual's recursive comparison during commit; it must terminate via
    // seen-pair tracking, not overflow the call stack.
    const authority = new IdbProjectCanonicalAuthority();
    const cyclic: Record<string, unknown> = { name: 'cyclic' };
    cyclic['self'] = cyclic;
    await seedProjectRecord(authority, { data: baseProjectPayload(), opaqueSibling: cyclic });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');
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
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    // QNBS-v3: an actual commit is what establishes the "migrated" companion marker now.
    const committed = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Confirmed canonical' } },
    });
    expect(committed.status).toBe('COMMITTED');
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
