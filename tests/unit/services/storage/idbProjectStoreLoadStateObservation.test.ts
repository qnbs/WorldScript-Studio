/**
 * Tests IdbProjectStore#loadState wires the as-persisted project object through
 * observeProjectVersionClassificationFromObject (contract section 2.8's universal ingress
 * admission, Slice B) before any default-backfilling in validateAndFixState runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  observe: vi.fn(),
}));

vi.mock('../../../../features/project/projectSchemaVersionShadow', () => ({
  observeProjectVersionClassificationFromObject: h.observe,
}));

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  resolveProtectedWriteKey: vi.fn().mockResolvedValue(null),
  assertNoActiveEncryptionMigration: vi.fn().mockResolvedValue(undefined),
  idbEncryptWithKey: vi.fn(),
  idbReadSecure: vi.fn(async (raw: unknown) => raw),
  assertIdbProtectedWriteAllowed: vi.fn().mockResolvedValue(undefined),
  assertSecureStorageReadable: vi.fn().mockResolvedValue(undefined),
}));

import { IdbProjectStore } from '../../../../services/storage/idbProjectStore';

interface FakeIdbRequest {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  error: unknown;
}

function makeFakeRequest(result: unknown): FakeIdbRequest {
  return { result, onsuccess: null, onerror: null, error: null };
}

function makeFakeStore(projectResult: unknown, settingsResult: unknown) {
  const projectRequest = makeFakeRequest(projectResult);
  const settingsRequest = makeFakeRequest(settingsResult);
  const store = {
    get: (key: string) => (key === 'project' ? projectRequest : settingsRequest),
  };
  return { store, projectRequest, settingsRequest };
}

beforeEach(() => {
  h.observe.mockReset();
});

describe('IdbProjectStore#loadState — universal ingress admission observation', () => {
  it('observes the as-persisted project data before default-backfilling', async () => {
    const projectStore = new IdbProjectStore();
    const persistedData = { title: 'Old Project', manuscript: [] };
    // QNBS-v3: captures a snapshot at call time - persistedData is mutated in-place by the backfill logic afterward, so asserting against the live reference later would see the post-backfill state instead.
    let observedSnapshot: unknown;
    h.observe.mockImplementation((data: unknown) => {
      observedSnapshot = JSON.parse(JSON.stringify(data));
    });
    const { store, projectRequest, settingsRequest } = makeFakeStore(
      { data: persistedData },
      undefined,
    );
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    const result = await loadPromise;

    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.observe).toHaveBeenCalledWith(persistedData, 'idb-project-load');
    expect(observedSnapshot).not.toHaveProperty('projectGoals');
    expect(result?.project?.data).toHaveProperty('projectGoals');
  });

  it('observes a flat/malformed present record by falling back to the envelope itself', async () => {
    // QNBS-v3: neither .present.data nor .data resolves here (a flat/corrupt payload) - the observation must not be silently skipped for a present-but-unusual record.
    const projectStore = new IdbProjectStore();
    const flatPayload = { title: 'Flat legacy shape', manuscript: [] };
    const { store, projectRequest, settingsRequest } = makeFakeStore(flatPayload, undefined);
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    await loadPromise;

    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.observe).toHaveBeenCalledWith(flatPayload, 'idb-project-load');
  });

  it('observes an explicit null payload as itself, not the outer envelope', async () => {
    // QNBS-v3: a persisted null/false payload is a real (malformed) classification target - falling back to the envelope on any falsy value would misreport it as the envelope's own LEGACY_UNVERSIONED shape instead of MALFORMED.
    const projectStore = new IdbProjectStore();
    const envelope = { data: null };
    const { store, projectRequest, settingsRequest } = makeFakeStore(envelope, undefined);
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    await loadPromise;

    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.observe).toHaveBeenCalledWith(null, 'idb-project-load');
  });

  it('observes a top-level falsy-but-present project record as itself', async () => {
    // QNBS-v3: project !== undefined (not truthiness) gates this - a corrupted top-level null/false record is a real classification target, distinct from an absent IDB record (undefined), even though both trigger the same "no project to load" early return below.
    const projectStore = new IdbProjectStore();
    const { store, projectRequest, settingsRequest } = makeFakeStore(null, undefined);
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    const result = await loadPromise;

    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.observe).toHaveBeenCalledWith(null, 'idb-project-load');
    expect(result).toBeUndefined();
  });

  it('classifies a flat record with its own schemaVersion directly, not via a coincidental data field', async () => {
    // QNBS-v3: a top-level schemaVersion is self-describing and must win over the envelope-unwrap heuristic - otherwise a FUTURE document with an unrelated truthy data/present field gets misread as LEGACY_UNVERSIONED via that field instead of its own header.
    const projectStore = new IdbProjectStore();
    const futureFlatRecord = { schemaVersion: 999, data: {} };
    const { store, projectRequest, settingsRequest } = makeFakeStore(futureFlatRecord, undefined);
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    await loadPromise;

    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.observe).toHaveBeenCalledWith(futureFlatRecord, 'idb-project-load');
  });

  it('does not observe when no project is persisted', async () => {
    const projectStore = new IdbProjectStore();
    const { store, projectRequest, settingsRequest } = makeFakeStore(undefined, { theme: 'dark' });
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const loadPromise = projectStore.loadState();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectRequest.onsuccess?.();
    settingsRequest.onsuccess?.();
    await loadPromise;

    expect(h.observe).not.toHaveBeenCalled();
  });
});
