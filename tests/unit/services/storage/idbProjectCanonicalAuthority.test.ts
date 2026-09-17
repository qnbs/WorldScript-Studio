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

// QNBS-v3: bypasses admission/classification so a test can assert the raw §2.7 marker was actually persisted, not just that the public admission result implies it.
async function readGenerationRecord(authority: IdbProjectCanonicalAuthority): Promise<unknown> {
  const store = await (authority as unknown as StoreWithObjectStoreAccess).getObjectStore(
    APP_DATA_STORE,
    'readonly',
  );
  return new Promise((resolve, reject) => {
    const request = store.get('__idb_project_canonical_generation_v1__');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
    expect(admission.envelope).toEqual({ kind: 'data', originalEnvelope: seeded });
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
    expect(admission.envelope).toEqual({ kind: 'present', originalEnvelope: seeded });
  });

  it('recognizes a flat, self-describing record (no data/present wrapper at all) via its own schemaVersion', async () => {
    // QNBS-v3: mirrors idbProjectStore.ts#selectIdbProjectObservationTarget's own precedent -- the real production shape saveProject(StoryProject) can write directly, with no envelope.
    const authority = new IdbProjectCanonicalAuthority();
    const seeded = baseProjectPayload();
    await seedProjectRecord(authority, seeded);

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ kind: 'flat' });

    // QNBS-v3: a flat record must stay flat on commit -- gaining a {data: ...} wrapper it never had would be its own kind of silent corruption.
    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Flat Story' } },
    });
    expect(result.status).toBe('COMMITTED');
    const reloaded = await authority.loadCanonicalProjectAdmission();
    if (reloaded.status !== 'CURRENT') throw new Error('expected CURRENT');
    expect(reloaded.envelope).toEqual({ kind: 'flat' });
    expect(JSON.parse(reloaded.currentRaw)).toMatchObject({ title: 'Renamed Flat Story' });
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

  it('treats a record with neither a data/present.data wrapper nor its own schemaVersion as a flat LEGACY_UNVERSIONED candidate', async () => {
    // QNBS-v3: real shape validation (title, characters, etc.) is importedProjectJsonSchema's job, not this classifier's -- an unrecognized flat shape is LEGACY_UNVERSIONED (not admitted for ordinary edits either way), never MALFORMED, matching classifyRawProjectVersionFromParsed's own schemaVersion-only contract.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { unrelated: 'value' });

    await expect(authority.loadCanonicalProjectAdmission()).resolves.toEqual({
      status: 'NOT_ADMITTED',
      classification: 'LEGACY_UNVERSIONED',
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

  it('detects a concurrent change to a Map-valued opaque envelope sibling that JSON.stringify cannot distinguish', async () => {
    // QNBS-v3 regression: JSON.stringify serializes every Map as "{}" regardless of its entries, so
    // a JSON.stringify-based raw-bytes comparison would wrongly treat two DIFFERENT Maps as equal --
    // the fence must use a type-aware structural comparison instead. The Map lives as an envelope
    // SIBLING of `data` (e.g. redux-undo bookkeeping), not inside `data` itself -- a Map *inside*
    // `data` fails the admission-time lossless round-trip check and is classified MALFORMED instead.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload(),
      meta: new Map([['a', 1]]),
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        // QNBS-v3: same JSON-visible content but a genuinely different Map -- JSON.stringify collapses both Maps to identical text, so even commitOwnedProjectEdit's own generation check can't see this.
        await seedProjectRecord(authority, {
          data: baseProjectPayload(),
          meta: new Map([['a', 2]]),
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

  it('does not false-positive CONFLICT when a Set-valued envelope sibling contains structurally-identical objects at different references', async () => {
    // QNBS-v3 regression: comparing Set/Map elements via .has() uses reference equality, so IndexedDB
    // structured-clone re-reading the SAME unchanged content at a NEW object identity would wrongly
    // report a conflict; the fence must compare Set/Map elements structurally instead.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload(),
      tags: new Set([{ name: 'fantasy' }]),
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');
  });

  it('detects a change when structured-clone values of genuinely different exotic types occupy the same envelope-sibling field', async () => {
    // QNBS-v3 regression: Date and RegExp instances both have zero own enumerable keys, so a
    // plain-object fallback comparison would wrongly treat a Date-vs-RegExp mismatch as two equal
    // empty objects; the fence must require both values to be genuine plain objects for that path.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload(),
      marker: new Date('2026-01-01'),
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        await seedProjectRecord(authority, {
          data: baseProjectPayload(),
          marker: /raced-in/,
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

  it('classifies a project record MALFORMED when an opaque field inside `data` itself cannot survive a JSON round-trip', async () => {
    // QNBS-v3: a Map inside `data` would otherwise be silently blanked to "{}" and lost on the next commit -- refusing it here is the same outcome a cyclic value inside `data` already gets from JSON.stringify throwing.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: { ...baseProjectPayload(), meta: new Map([['a', 1]]) },
    });

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('NOT_ADMITTED');
  });

  it('fails closed (VERIFICATION_FAILED) instead of silently corrupting a large envelope sibling that compressData cannot preserve', async () => {
    // QNBS-v3 regression: compressData JSON-serializes payloads at/above its 10KB threshold, so a Map-valued envelope sibling would otherwise be silently blanked to "{}" and permanently lost on write.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload({ manuscript: 'x'.repeat(20_000) }),
      history: new Map([['a', 1]]),
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Should not silently corrupt history' } },
    });

    expect(result.status).toBe('VERIFICATION_FAILED');
  });

  it('does not false-positive CONFLICT for an unrecognized typed-array envelope sibling', async () => {
    // QNBS-v3 regression: only Uint8Array had a dedicated comparator -- any other typed array fell through to the "unequal" default, so an unchanged sibling would spuriously CONFLICT on every commit.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload(),
      checksum: new Int16Array([1, 2, 3]),
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');
  });

  it('does not false-positive CONFLICT for a bare ArrayBuffer envelope sibling', async () => {
    // QNBS-v3 regression: ArrayBuffer.isView() never matches a bare ArrayBuffer -- it needs its own comparator, distinct from the typed-array-view one.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload(),
      raw: new Uint8Array([9, 9, 9]).buffer,
    });
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');

    const result = await authority.commitCanonicalProjectEdit({
      expectedGeneration: admission.generation,
      edit: { fields: { title: 'Renamed Story' } },
    });

    expect(result.status).toBe('COMMITTED');
  });

  it('classifies a project record MALFORMED when a -0 value inside `data` would silently become 0 through JSON', async () => {
    // QNBS-v3 regression: JSON.stringify(-0) emits "0", and === treats -0 and 0 as equal -- Object.is is required to catch this as a lossy round-trip.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, {
      data: baseProjectPayload({ negativeZeroField: -0 }),
    });

    const admission = await authority.loadCanonicalProjectAdmission();

    expect(admission.status).toBe('NOT_ADMITTED');
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

function legacyProjectPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'My Legacy Story',
    logline: 'A legacy logline.',
    author: 'Author',
    // QNBS-v3: a field genuinely absent from importedProjectJsonSchema -- proves opaque data survives the byte-splice stamp, not just fields the schema happens to model.
    outlineNote: 'An opaque, Core-unmodeled field not in the import schema.',
    characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    worlds: { ids: [], entities: {} },
    ...overrides,
  };
}

describe('IdbProjectCanonicalAuthority#commitLegacyToV1Migration', () => {
  it('durably migrates a LEGACY_UNVERSIONED record to CURRENT, stamping schemaVersion losslessly', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyProjectPayload() });

    const result = await authority.commitLegacyToV1Migration();

    expect(result.status).toBe('COMMITTED');
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    const parsed = JSON.parse(admission.currentRaw) as {
      schemaVersion: number;
      title: string;
      outlineNote: string;
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.title).toBe('My Legacy Story');
    expect(parsed.outlineNote).toBe('An opaque, Core-unmodeled field not in the import schema.');
  });

  it('reports NOT_ELIGIBLE for an already-CURRENT document', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload() });

    const result = await authority.commitLegacyToV1Migration();

    expect(result).toEqual({ status: 'NOT_ELIGIBLE', classification: 'CURRENT' });
  });

  it('reports NOT_ELIGIBLE for a FUTURE document', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: baseProjectPayload({ schemaVersion: 999 }) });

    const result = await authority.commitLegacyToV1Migration();

    expect(result).toEqual({ status: 'NOT_ELIGIBLE', classification: 'FUTURE' });
  });

  it('reports NOT_ELIGIBLE for a legacy document that fails schema validation', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    // QNBS-v3: "title" is required by importedProjectJsonSchema -- an unversioned-looking header alone must never grant migration authority.
    const { title: _title, ...invalidLegacy } = legacyProjectPayload();
    await seedProjectRecord(authority, { data: invalidLegacy });

    const result = await authority.commitLegacyToV1Migration();

    expect(result).toEqual({ status: 'NOT_ELIGIBLE', classification: 'MALFORMED' });
  });

  it('reports NOT_ELIGIBLE when no project record exists yet', async () => {
    const authority = new IdbProjectCanonicalAuthority();

    const result = await authority.commitLegacyToV1Migration();

    expect(result).toEqual({ status: 'NOT_ELIGIBLE', classification: 'ABSENT' });
  });

  it('fails closed (CONFLICT) when a concurrent writer changes the raw bytes during the async encrypt window', async () => {
    // QNBS-v3 regression: the migration commit must go through the SAME raw-bytes fence as an
    // ordinary edit, not a second, independent write protocol.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyProjectPayload() });

    const spy = vi
      .spyOn(storageEncryptionService, 'resolveProtectedWriteKey')
      .mockImplementationOnce(async () => {
        await seedProjectRecord(authority, {
          data: legacyProjectPayload({ title: 'Raced In' }),
        });
        return null;
      });

    const result = await authority.commitLegacyToV1Migration();

    spy.mockRestore();
    expect(result.status).toBe('CONFLICT');
    const reloaded = await authority.loadCanonicalProjectAdmission();
    // QNBS-v3: the raced-in write is still legacy-shaped -- the rejected migration never landed, so it stays NOT_ADMITTED, not CURRENT.
    expect(reloaded).toEqual({ status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' });
  });

  it('writes the companion generation marker as migrated:true, and refuses to re-migrate a stale legacy write that supersedes it afterward (§2.7)', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyProjectPayload() });

    const result = await authority.commitLegacyToV1Migration();
    expect(result.status).toBe('COMMITTED');

    const generationRecord = await readGenerationRecord(authority);
    expect(generationRecord).toMatchObject({ migrated: true });

    // QNBS-v3 (#553 §2.7): a stale legacy-shaped write superseding an already-migrated project must never be treated as an ordinary migration candidate again.
    await seedProjectRecord(authority, {
      data: legacyProjectPayload({ title: 'Stale Downgrade' }),
    });

    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission).toEqual({
      status: 'GENERATION_CONTRADICTION',
      classification: 'LEGACY_UNVERSIONED',
    });
    const migrationAttempt = await authority.commitLegacyToV1Migration();
    expect(migrationAttempt).toEqual({
      status: 'NOT_ELIGIBLE',
      classification: 'GENERATION_CONTRADICTION:LEGACY_UNVERSIONED',
    });
  });

  it('recognizes the {present: {data}} redux-undo envelope shape -- the real on-disk shape idbProjectStore.saveSlice writes', async () => {
    // QNBS-v3: the {data} fixture used elsewhere in this file is a test convenience -- this proves the migration path also handles the actual production envelope shape.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { present: { data: legacyProjectPayload() } });

    const result = await authority.commitLegacyToV1Migration();

    expect(result.status).toBe('COMMITTED');
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope.kind).toBe('present');
    const parsed = JSON.parse(admission.currentRaw) as { schemaVersion: number; title: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.title).toBe('My Legacy Story');
  });

  it('migrates a flat legacy record (no data/present wrapper at all) and keeps it flat', async () => {
    // QNBS-v3: a genuine pre-v1 project necessarily lacks schemaVersion, so it can't hit the flat-record self-describing check either -- this proves the unwrapProjectEnvelope fallback admits it for migration too, not just ordinary edits.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, legacyProjectPayload());

    const result = await authority.commitLegacyToV1Migration();

    expect(result.status).toBe('COMMITTED');
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    expect(admission.envelope).toEqual({ kind: 'flat' });
    const parsed = JSON.parse(admission.currentRaw) as { schemaVersion: number; title: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.title).toBe('My Legacy Story');
  });

  it('round-trips a migration correctly when at-rest encryption is active', async () => {
    // QNBS-v3: mirrors the existing commitCanonicalProjectEdit encryption test -- the migration path runs the same encrypt/decrypt flow and had no dedicated coverage of its own.
    await initIdbEncryption('test-pass');
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyProjectPayload() });

    const result = await authority.commitLegacyToV1Migration();

    expect(result.status).toBe('COMMITTED');
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
    if (admission.status !== 'CURRENT') return;
    const parsed = JSON.parse(admission.currentRaw) as { schemaVersion: number; title: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.title).toBe('My Legacy Story');
  });

  it('clearCanonicalGenerationMarker lets a genuinely new legacy project be admitted after a deliberate whole-project replacement', async () => {
    // QNBS-v3: without clearing, the global §2.7 marker would otherwise permanently misclassify any future distinct project as a stale downgrade of whatever was migrated before it.
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyProjectPayload() });
    const migrated = await authority.commitLegacyToV1Migration();
    expect(migrated.status).toBe('COMMITTED');

    await authority.clearCanonicalGenerationMarker();
    await seedProjectRecord(authority, {
      data: legacyProjectPayload({ title: 'A Different Story' }),
    });

    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission).toEqual({ status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' });
    const result = await authority.commitLegacyToV1Migration();
    expect(result.status).toBe('COMMITTED');
  });
});
