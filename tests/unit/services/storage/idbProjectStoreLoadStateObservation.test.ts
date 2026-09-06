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
