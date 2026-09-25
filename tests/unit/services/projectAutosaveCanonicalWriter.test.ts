// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-functional indexedDB stub, same as the canonical authority test.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../features/project/projectState';
import { getPersistedProjectPayload } from '../../../services/appBootstrap';
import { APP_DATA_STORE } from '../../../services/dbConstants';
import type { CanonicalAutosaveResult } from '../../../services/projectAutosaveCanonicalWriter';
import {
  assertCanonicalAutosaveSucceeded,
  buildInitialCanonicalRaw,
  saveAutosaveSnapshotCanonical,
} from '../../../services/projectAutosaveCanonicalWriter';
import { _resetDbForTest } from '../../../services/storage';
import type {
  CanonicalProjectAdmission,
  CommitCanonicalProjectEditResult,
  CommitLegacyToV1MigrationResult,
  CreateCanonicalProjectResult,
} from '../../../services/storage/idbProjectCanonicalAuthority';
import { IdbProjectCanonicalAuthority } from '../../../services/storage/idbProjectCanonicalAuthority';
import { IdbProjectStore } from '../../../services/storage/idbProjectStore';
import { clearIdbEncryptionKey } from '../../../services/storage/storageEncryptionService';

// QNBS-v3: same mock discipline as appBootstrap.test.ts -- the real storageService module pulls the collab-transport vendor fork (y-webrtc/lib0), which cannot resolve under the node test env; only getPersistedProjectPayload is under test here.
vi.mock('../../../services/tauriRuntime', () => ({ isTauriRuntime: () => false }));
vi.mock('../../../services/dbService', () => ({ dbService: { loadState: vi.fn() } }));
vi.mock('../../../services/storageService', () => ({ storageService: {} }));
// QNBS-v3: idbProjectStore pulls collaborationService → @domain/collab-transport (y-webrtc/lib0), unresolvable under node env; only DEFAULT_WEBRTC_SIGNALING_URLS is needed and never on the loadState path.
vi.mock('../../../services/collaborationService', () => ({
  DEFAULT_WEBRTC_SIGNALING_URLS: [],
}));

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
  _resetDbForTest();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

// QNBS-v3: overrides stay loosely typed -- fixtures only need the fields the lifecycle paths touch.
function snapshot(overrides: Record<string, unknown> = {}): ProjectData {
  return {
    id: 'default',
    title: 'My Story',
    logline: 'A logline.',
    characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    worlds: { ids: ['w1'], entities: { w1: { id: 'w1', name: 'Aldoria' } } },
    outline: [],
    manuscript: [],
    ...overrides,
  } as unknown as ProjectData;
}

function legacyRecordPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'My Legacy Story',
    logline: 'A legacy logline.',
    // QNBS-v3: an opaque field outside the import schema -- proves it survives migration AND the same-call edit commit.
    outlineNote: 'An opaque, Core-unmodeled field.',
    characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    worlds: { ids: [], entities: {} },
    ...overrides,
  };
}

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

async function readProjectRecord(authority: IdbProjectCanonicalAuthority): Promise<unknown> {
  const store = await (authority as unknown as StoreWithObjectStoreAccess).getObjectStore(
    APP_DATA_STORE,
    'readonly',
  );
  return new Promise((resolve, reject) => {
    const request = store.get('project');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const SCRIPTED_CURRENT_RAW = JSON.stringify({
  schemaVersion: 1,
  title: 'Persisted Story',
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
});

function scriptedCurrentAdmission(generation = 'current-generation'): CanonicalProjectAdmission {
  return {
    status: 'CURRENT',
    currentRaw: SCRIPTED_CURRENT_RAW,
    generation,
    envelope: { kind: 'data', originalEnvelope: {} },
  };
}

function makeScriptedAuthority(input: {
  admissions: readonly CanonicalProjectAdmission[];
  creates?: readonly CreateCanonicalProjectResult[];
  migrations?: readonly CommitLegacyToV1MigrationResult[];
  edits?: readonly CommitCanonicalProjectEditResult[];
}): IdbProjectCanonicalAuthority & {
  loadCanonicalProjectAdmission: ReturnType<typeof vi.fn>;
  createCanonicalProjectIfAbsent: ReturnType<typeof vi.fn>;
  commitLegacyToV1Migration: ReturnType<typeof vi.fn>;
  commitCanonicalProjectEdit: ReturnType<typeof vi.fn>;
} {
  const next = <T>(values: readonly T[], index: { value: number }): T => {
    if (index.value >= values.length) throw new Error('scripted authority ran out of results');
    const value = values[index.value++];
    if (value === undefined) throw new Error('scripted authority ran out of results');
    return value;
  };
  const admissionIndex = { value: 0 };
  const createIndex = { value: 0 };
  const migrationIndex = { value: 0 };
  const editIndex = { value: 0 };
  const authority = {
    loadCanonicalProjectAdmission: vi.fn(async () => next(input.admissions, admissionIndex)),
    createCanonicalProjectIfAbsent: vi.fn(async (_params: { currentRaw: string }) =>
      next(input.creates ?? [], createIndex),
    ),
    commitLegacyToV1Migration: vi.fn(async () => next(input.migrations ?? [], migrationIndex)),
    commitCanonicalProjectEdit: vi.fn(async (_params: unknown) =>
      next(input.edits ?? [], editIndex),
    ),
  };
  return authority as unknown as IdbProjectCanonicalAuthority & {
    loadCanonicalProjectAdmission: ReturnType<typeof vi.fn>;
    createCanonicalProjectIfAbsent: ReturnType<typeof vi.fn>;
    commitLegacyToV1Migration: ReturnType<typeof vi.fn>;
    commitCanonicalProjectEdit: ReturnType<typeof vi.fn>;
  };
}

describe('saveAutosaveSnapshotCanonical', () => {
  it.each([
    { status: 'REFUSED', reason: 'FUTURE' },
    { status: 'CONFLICT' },
    { status: 'VERIFICATION_FAILED', reason: 'round-trip failed' },
    { status: 'MALFORMED_SOURCE', reason: 'invalid carrier' },
  ] satisfies CanonicalAutosaveResult[])('rejects non-committing result %o', (result) => {
    expect(() => assertCanonicalAutosaveSucceeded(result)).toThrow(
      `Canonical autosave did not commit (${result.status})`,
    );
  });

  it('ABSENT: atomically creates the canonical CURRENT record in the browser { data } envelope', async () => {
    const authority = new IdbProjectCanonicalAuthority();

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result.status).toBe('CREATED');
    const admission = await authority.loadCanonicalProjectAdmission();
    expect(admission.status).toBe('CURRENT');
  });

  it('ABSENT: the created record cold-boots through the ordinary IDB load/bootstrap path with content and schema metadata intact', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const created = await saveAutosaveSnapshotCanonical(snapshot(), authority);
    expect(created.status).toBe('CREATED');

    // QNBS-v3: a record the canonical authority can read but appBootstrap cannot hydrate would be a first-save that vanishes on reload -- this is the real cold-boot regression for the { data: ... } envelope contract.
    const state = await new IdbProjectStore().loadState();
    expect(state).toBeDefined();
    const payload = getPersistedProjectPayload(state?.project);
    expect(payload).toBeDefined();
    expect(payload?.title).toBe('My Story');
    expect(payload?.characters.ids).toEqual(['c1']);
    expect(payload?.worlds.ids).toEqual(['w1']);
    expect((payload as unknown as Record<string, unknown>)['schemaVersion']).toBe(1);
  });

  it('ABSENT: a runtime-extra schemaVersion on the snapshot is discarded in favor of the authority-owned CURRENT version', async () => {
    const authority = new IdbProjectCanonicalAuthority();

    const result = await saveAutosaveSnapshotCanonical(snapshot({ schemaVersion: 999 }), authority);

    expect(result.status).toBe('CREATED');
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    expect(JSON.parse(admission.currentRaw)).toMatchObject({ schemaVersion: 1 });
  });

  it('CURRENT: commits the bridge edit and durably persists the snapshot changes', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await saveAutosaveSnapshotCanonical(snapshot(), authority);

    const result = await saveAutosaveSnapshotCanonical(
      snapshot({
        title: 'Renamed Story',
        characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice Renamed' } } },
      }),
      authority,
    );

    expect(result.status).toBe('SAVED');
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    const parsed = JSON.parse(admission.currentRaw) as {
      title: string;
      characters: { entities: Record<string, { name: string }> };
    };
    expect(parsed.title).toBe('Renamed Story');
    expect(parsed.characters.entities['c1']?.name).toBe('Alice Renamed');
  });

  it('LEGACY_UNVERSIONED: migrates durably and saves the current snapshot edits in the SAME call', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyRecordPayload() });

    const result = await saveAutosaveSnapshotCanonical(
      snapshot({ title: 'Edited After Migration' }),
      authority,
    );

    expect(result.status).toBe('MIGRATED_AND_SAVED');
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    const parsed = JSON.parse(admission.currentRaw) as {
      schemaVersion: number;
      title: string;
      outlineNote: string;
    };
    expect(parsed.schemaVersion).toBe(1);
    // QNBS-v3: the current Redux snapshot's newer edit landed in the same call...
    expect(parsed.title).toBe('Edited After Migration');
    // QNBS-v3: ...and the opaque legacy field survived both the migration stamp and the follow-up edit commit.
    expect(parsed.outlineNote).toBe('An opaque, Core-unmodeled field.');
  });

  it('allows one create-conflict re-evaluation, then commits the CURRENT edit without another admission', async () => {
    const authority = makeScriptedAuthority({
      admissions: [{ status: 'ABSENT' }, scriptedCurrentAdmission()],
      creates: [{ status: 'CONFLICT' }],
      edits: [{ status: 'COMMITTED', generation: 'saved-generation' }],
    });

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result).toEqual({ status: 'SAVED', generation: 'saved-generation' });
    expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(2);
    expect(authority.createCanonicalProjectIfAbsent).toHaveBeenCalledTimes(1);
    expect(authority.commitCanonicalProjectEdit).toHaveBeenCalledTimes(1);
  });

  it('does not retry an edit conflict', async () => {
    const authority = makeScriptedAuthority({
      admissions: [scriptedCurrentAdmission()],
      edits: [{ status: 'CONFLICT' }],
    });

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result.status).toBe('CONFLICT');
    expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(1);
    expect(authority.commitCanonicalProjectEdit).toHaveBeenCalledTimes(1);
  });

  it('maps an edit-time generation contradiction to a typed refusal', async () => {
    const authority = makeScriptedAuthority({
      admissions: [scriptedCurrentAdmission()],
      edits: [
        {
          status: 'NOT_ADMITTED_FOR_WRITE',
          classification: 'GENERATION_CONTRADICTION:CURRENT',
        },
      ],
    });

    await expect(saveAutosaveSnapshotCanonical(snapshot(), authority)).resolves.toEqual({
      status: 'REFUSED',
      reason: 'GENERATION_CONTRADICTION',
    });
  });

  it.each([
    ['CONFLICT without retrying', { status: 'CONFLICT' }, { status: 'CONFLICT' }],
    [
      'FUTURE as a typed refusal',
      { status: 'NOT_ELIGIBLE', classification: 'FUTURE' },
      { status: 'REFUSED', reason: 'FUTURE' },
    ],
    [
      'VERIFICATION_FAILED without changing its typed meaning',
      { status: 'VERIFICATION_FAILED', reason: 'migration verify failed' },
      { status: 'VERIFICATION_FAILED', reason: 'migration verify failed' },
    ],
  ] as const)(
    'keeps a terminal migration result explicit: %s',
    async (_scenario, migration, expected) => {
      const authority = makeScriptedAuthority({
        admissions: [{ status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' }],
        migrations: [migration],
      });

      await expect(saveAutosaveSnapshotCanonical(snapshot(), authority)).resolves.toEqual(expected);
      expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(1);
      expect(authority.commitLegacyToV1Migration).toHaveBeenCalledTimes(1);
    },
  );

  it('uses one re-evaluation when migration observes benign CURRENT progression', async () => {
    const authority = makeScriptedAuthority({
      admissions: [
        { status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' },
        scriptedCurrentAdmission(),
      ],
      migrations: [{ status: 'NOT_ELIGIBLE', classification: 'CURRENT' }],
      edits: [{ status: 'COMMITTED', generation: 'saved-generation' }],
    });

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result).toEqual({ status: 'SAVED', generation: 'saved-generation' });
    expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(2);
    expect(authority.commitLegacyToV1Migration).toHaveBeenCalledTimes(1);
    expect(authority.commitCanonicalProjectEdit).toHaveBeenCalledTimes(1);
  });

  it('requires CURRENT after a successful migration and refuses a second state transition', async () => {
    const authority = makeScriptedAuthority({
      admissions: [
        { status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' },
        { status: 'NOT_ADMITTED', classification: 'FUTURE' },
      ],
      migrations: [{ status: 'COMMITTED', generation: 'migrated-generation' }],
    });

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result).toEqual({ status: 'REFUSED', reason: 'FUTURE' });
    expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(2);
    expect(authority.commitCanonicalProjectEdit).not.toHaveBeenCalled();
  });

  it('refuses a generation contradiction after migration before editing', async () => {
    const authority = makeScriptedAuthority({
      admissions: [
        { status: 'NOT_ADMITTED', classification: 'LEGACY_UNVERSIONED' },
        { status: 'GENERATION_CONTRADICTION', classification: 'LEGACY_UNVERSIONED' },
      ],
      migrations: [{ status: 'COMMITTED', generation: 'migrated-generation' }],
    });

    await expect(saveAutosaveSnapshotCanonical(snapshot(), authority)).resolves.toEqual({
      status: 'REFUSED',
      reason: 'GENERATION_CONTRADICTION',
    });
  });

  it('propagates a typed create verification failure without a second admission', async () => {
    const authority = makeScriptedAuthority({
      admissions: [{ status: 'ABSENT' }],
      creates: [{ status: 'VERIFICATION_FAILED', reason: 'create verify failed' }],
    });

    await expect(saveAutosaveSnapshotCanonical(snapshot(), authority)).resolves.toEqual({
      status: 'VERIFICATION_FAILED',
      reason: 'create verify failed',
    });
    expect(authority.loadCanonicalProjectAdmission).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['MALFORMED', 'MALFORMED'],
    ['FUTURE', 'FUTURE'],
    ['SUPPORTED_OLDER', 'SUPPORTED_OLDER'],
    ['UNSUPPORTED_OLDER', 'UNSUPPORTED_OLDER'],
  ] as const)('refuses an initially non-admitted %s source', (classification, reason) => {
    const authority = makeScriptedAuthority({
      admissions: [{ status: 'NOT_ADMITTED', classification }],
    });

    return expect(saveAutosaveSnapshotCanonical(snapshot(), authority)).resolves.toEqual({
      status: 'REFUSED',
      reason,
    });
  });

  it('keeps generation contradiction, verification failure, and malformed source distinct', async () => {
    const contradictionAuthority = makeScriptedAuthority({
      admissions: [{ status: 'GENERATION_CONTRADICTION', classification: 'LEGACY_UNVERSIONED' }],
    });
    await expect(
      saveAutosaveSnapshotCanonical(snapshot(), contradictionAuthority),
    ).resolves.toEqual({
      status: 'REFUSED',
      reason: 'GENERATION_CONTRADICTION',
    });

    const verificationAuthority = makeScriptedAuthority({
      admissions: [scriptedCurrentAdmission()],
      edits: [{ status: 'VERIFICATION_FAILED', reason: 'round-trip failed' }],
    });
    await expect(saveAutosaveSnapshotCanonical(snapshot(), verificationAuthority)).resolves.toEqual(
      {
        status: 'VERIFICATION_FAILED',
        reason: 'round-trip failed',
      },
    );

    const malformedAuthority = makeScriptedAuthority({
      admissions: [scriptedCurrentAdmission()],
      edits: [{ status: 'MALFORMED_SOURCE', reason: 'invalid carrier' }],
    });
    await expect(saveAutosaveSnapshotCanonical(snapshot(), malformedAuthority)).resolves.toEqual({
      status: 'MALFORMED_SOURCE',
      reason: 'invalid carrier',
    });
  });

  it.each([
    ['FUTURE', { data: { schemaVersion: 999, ...legacyRecordPayload() } }],
    ['UNSUPPORTED_OLDER', { data: { schemaVersion: 0, ...legacyRecordPayload() } }],
    ['MALFORMED', 'not an object at all'],
  ] as const)('fails closed with REFUSED %s and writes nothing', async (reason, seeded) => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, seeded);

    const result = await saveAutosaveSnapshotCanonical(snapshot(), authority);

    expect(result).toEqual({ status: 'REFUSED', reason });
    expect(await readProjectRecord(authority)).toEqual(seeded);
    const store = await (authority as unknown as StoreWithObjectStoreAccess).getObjectStore(
      APP_DATA_STORE,
      'readonly',
    );
    const generation = await new Promise((resolve, reject) => {
      const request = store.get('__idb_project_canonical_generation_v1__');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(generation).toBeUndefined();
  });
});

describe('saveAutosaveSnapshotCanonical replacement (#553 a10)', () => {
  const predecessorA = {
    schemaVersion: 1,
    title: 'Project A',
    futureWidget: { opaque: 'A-only' },
    characters: { ids: ['a1'], entities: { a1: { id: 'a1', name: 'A-Char', aOnly: true } } },
    worlds: { ids: [], entities: {} },
  };

  async function storedProject(authority: IdbProjectCanonicalAuthority) {
    const admission = await authority.loadCanonicalProjectAdmission();
    if (admission.status !== 'CURRENT') throw new Error('expected CURRENT');
    return { raw: admission.currentRaw, generation: admission.generation };
  }

  it('an ordinary edit keeps the predecessor’s opaque data (owned overlay)', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: predecessorA });

    const result = await saveAutosaveSnapshotCanonical(snapshot({ title: 'A edited' }), authority);

    expect(result.status).toBe('SAVED');
    expect((await storedProject(authority)).raw).toContain('A-only');
  });

  it('a replacement (reset/import/restore B) writes B as a fresh document with nothing of A', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: predecessorA });

    const result = await saveAutosaveSnapshotCanonical(
      snapshot({ title: 'Restored B' }),
      authority,
      {
        replacement: true,
      },
    );

    expect(result.status).toBe('SAVED');
    const { raw, generation } = await storedProject(authority);
    expect(raw).not.toContain('A-only');
    expect(raw).not.toContain('aOnly');
    expect(raw).not.toContain('Project A');
    expect(JSON.parse(raw)).toEqual(
      JSON.parse(buildInitialCanonicalRaw(snapshot({ title: 'Restored B' }))),
    );
    expect(result.status === 'SAVED' && result.generation).toBe(generation);
    expect(Object.keys((await readProjectRecord(authority)) as object)).toEqual(['data']);
  });

  it('a replacement over a legacy record migrates, then replaces without the legacy opaque field', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: legacyRecordPayload() });

    const result = await saveAutosaveSnapshotCanonical(snapshot({ title: 'B' }), authority, {
      replacement: true,
    });

    expect(result.status).toBe('MIGRATED_AND_SAVED');
    expect((await storedProject(authority)).raw).not.toContain('Core-unmodeled');
  });

  it('refuses a replacement against a moved generation and leaves the record untouched', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: predecessorA });
    const before = await readProjectRecord(authority);

    const result = await authority.commitCanonicalProjectReplacement({
      expectedGeneration: 'not-the-current-generation' as never,
      currentRaw: buildInitialCanonicalRaw(snapshot({ title: 'B' })),
    });

    expect(result.status).toBe('CONFLICT');
    expect(await readProjectRecord(authority)).toEqual(before);
  });

  it('refuses a replacement document that is not a valid CURRENT project, writing nothing', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seedProjectRecord(authority, { data: predecessorA });
    const before = await readProjectRecord(authority);
    const { generation } = await storedProject(authority);

    const result = await authority.commitCanonicalProjectReplacement({
      expectedGeneration: generation,
      currentRaw: JSON.stringify({ title: 'no schema' }),
    });

    expect(result.status).toBe('MALFORMED_SOURCE');
    expect(await readProjectRecord(authority)).toEqual(before);
  });
});
