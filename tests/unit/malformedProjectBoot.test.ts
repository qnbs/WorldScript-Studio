import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateStoredProject, requirePersistedProjectForStore } from '../../services/appBootstrap';
import { APP_DATA_STORE } from '../../services/dbConstants';
import { PersistedProjectNotLoadableError } from '../../services/persistedProjectErrors';
import { _resetDbForTest } from '../../services/storage';
import { IdbProjectCanonicalAuthority } from '../../services/storage/idbProjectCanonicalAuthority';
import { IdbProjectStore } from '../../services/storage/idbProjectStore';
import { clearIdbEncryptionKey } from '../../services/storage/storageEncryptionService';
import type { PersistedRootState } from '../../types';

// QNBS-v3: same mock discipline as projectAutosaveCanonicalWriter.test.ts — the real storageService/collaboration chain cannot resolve under the node env.
vi.mock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => false }));
vi.mock('../../services/dbService', () => ({ dbService: { loadState: vi.fn() } }));
vi.mock('../../services/storageService', () => ({ storageService: {} }));
vi.mock('../../services/collaborationService', () => ({ DEFAULT_WEBRTC_SIGNALING_URLS: [] }));

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

type StoreAccess = {
  getObjectStore: (name: string, mode: IDBTransactionMode) => Promise<IDBObjectStore>;
};

async function seed(authority: IdbProjectCanonicalAuthority, value: unknown): Promise<void> {
  const store = await (authority as unknown as StoreAccess).getObjectStore(
    APP_DATA_STORE,
    'readwrite',
  );
  await new Promise<void>((resolve, reject) => {
    store.put(value, 'project');
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

async function stored(authority: IdbProjectCanonicalAuthority): Promise<unknown> {
  const store = await (authority as unknown as StoreAccess).getObjectStore(
    APP_DATA_STORE,
    'readonly',
  );
  return new Promise((resolve) => {
    const request = store.get('project');
    request.onsuccess = () => resolve(request.result);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTest();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

const precious = {
  schemaVersion: 1,
  id: 'p1',
  title: 'Precious',
  logline: 'L',
  manuscript: [{ id: 's1', title: 'Ch', content: 'years of work' }],
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
};

// QNBS-v3 (#553 a9): the real IndexedDB read and boot decision — a stored project the editor cannot load is refused and kept, never swapped for a blank project that could save over it.
describe('browser boot with a stored project the editor cannot load (#553 a9)', () => {
  it('hydrates a valid stored project unchanged', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seed(authority, { data: { ...precious, outline: [] } });

    const loaded = await new IdbProjectStore().loadState();
    const project = requirePersistedProjectForStore(
      loaded?.project as PersistedRootState['project'],
    );

    expect(project?.present?.data?.title).toBe('Precious');
  });

  it.each([
    [
      'an outline that is not a list (admitted as CURRENT)',
      { data: { ...precious, outline: 'x' } },
    ],
    ['characters that cannot be read', { data: { ...precious, characters: 'x', outline: [] } }],
    ['a project value that is not an object', { data: 'garbage' }],
    ['a stored null project', null],
    ['a stored empty-string project', ''],
  ])('refuses %s and leaves the stored record untouched', async (_label, record) => {
    const authority = new IdbProjectCanonicalAuthority();
    await seed(authority, record);
    const before = JSON.stringify(await stored(authority));

    const loaded = await new IdbProjectStore().loadState();

    // A present record — even a falsy one — reaches the boot decision instead of reading as "no project".
    expect(loaded !== undefined && Object.hasOwn(loaded, 'project')).toBe(true);
    expect(() =>
      requirePersistedProjectForStore(loaded?.project as PersistedRootState['project']),
    ).toThrow(PersistedProjectNotLoadableError);
    expect(JSON.stringify(await stored(authority))).toBe(before);
  });

  it('keeps the new-user flow for an absent project and hydrates a stored one in place', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const settingsOnly = { settings: {} } as PersistedRootState;
    hydrateStoredProject(settingsOnly);
    hydrateStoredProject(undefined);
    expect(Object.hasOwn(settingsOnly, 'project')).toBe(false);

    await seed(authority, { data: { ...precious, outline: [] } });
    const loaded = (await new IdbProjectStore().loadState()) as PersistedRootState;
    hydrateStoredProject(loaded);
    expect(loaded.project?.present?.data?.title).toBe('Precious');
  });

  it('reports an absent project as absent when only settings are stored', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    const store = await (authority as unknown as StoreAccess).getObjectStore(
      APP_DATA_STORE,
      'readwrite',
    );
    await new Promise<void>((resolve) => {
      store.put({ theme: 'dark' }, 'settings');
      store.transaction.oncomplete = () => resolve();
    });

    const loaded = await new IdbProjectStore().loadState();

    expect(loaded).toBeDefined();
    expect(Object.hasOwn(loaded as object, 'project')).toBe(false);
  });

  it('refuses a stored falsy project through the boot hydration step', async () => {
    const authority = new IdbProjectCanonicalAuthority();
    await seed(authority, null);
    const loaded = (await new IdbProjectStore().loadState()) as PersistedRootState;
    expect(() => hydrateStoredProject(loaded)).toThrow(PersistedProjectNotLoadableError);
  });
});
