// QNBS-v3 (#553 §2.8): real IndexedDB authority (fake-indexeddb), not a mocked admission — IDB holds a structured value, so these assert what it actually yields, never an impossible lexical token.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DATA_STORE } from '../../../../services/dbConstants';
import { _resetDbForTest } from '../../../../services/storage';
import { idbProjectCanonicalAuthority } from '../../../../services/storage/idbProjectCanonicalAuthority';
import { IdbProjectStore } from '../../../../services/storage/idbProjectStore';
import { clearIdbEncryptionKey } from '../../../../services/storage/storageEncryptionService';

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

afterEach(async () => {
  // The singleton authority keeps its connection across tests, so clear the record explicitly.
  const store = await projectStore('readwrite');
  await new Promise<void>((resolve, reject) => {
    store.delete('project');
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
  clearIdbEncryptionKey();
});

async function projectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (idbProjectCanonicalAuthority as unknown as StoreWithObjectStoreAccess).getObjectStore(
    APP_DATA_STORE,
    mode,
  );
}

async function seed(value: unknown): Promise<void> {
  const store = await projectStore('readwrite');
  await new Promise<void>((resolve, reject) => {
    store.put(value, 'project');
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

async function readStored(): Promise<unknown> {
  const store = await projectStore('readonly');
  return new Promise((resolve, reject) => {
    const request = store.get('project');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const current = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'p1',
  title: 'Stored',
  logline: 'L',
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
  outline: [],
  manuscript: [],
  futureWidget: { nested: [1, 2, 3] },
  ...overrides,
});

describe('IdbProjectStore.loadCanonicalProjectRaw — real authority (#553 §2.8)', () => {
  it('returns the stored structured value as canonical text, opaque field included', async () => {
    await seed(current());
    const result = await new IdbProjectStore().loadCanonicalProjectRaw('p1');
    expect(result).toMatchObject({ status: 'CURRENT' });
    expect(JSON.parse((result as { raw: string }).raw)).toEqual(current());
  });

  it('refuses a CURRENT-version record whose owned fields fail the project schema', async () => {
    await seed(current({ title: 42 }));
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toMatchObject({
      status: 'REFUSED',
    });
  });

  it('admits a pre-version record in memory only — exported as CURRENT, stored record untouched', async () => {
    const { schemaVersion: _omit, ...legacy } = current();
    await seed(legacy);

    const result = await new IdbProjectStore().loadCanonicalProjectRaw('p1');

    expect(result).toMatchObject({ status: 'CURRENT' });
    expect(JSON.parse((result as { raw: string }).raw)).toMatchObject({ schemaVersion: 1 });
    expect(await readStored()).toEqual(legacy);
  });

  it.each([
    ['FUTURE', current({ schemaVersion: 99 })],
    ['MALFORMED', 'not a project'],
  ])('refuses a %s record', async (_label, value) => {
    await seed(value);
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toMatchObject({
      status: 'REFUSED',
    });
  });

  it('reads another project’s record as absent, and treats an empty stored id as id-less', async () => {
    await seed(current({ id: 'other' }));
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'ABSENT',
    });

    await seed(current({ id: '' }));
    await expect(new IdbProjectStore().loadEditorExportCarrier('')).resolves.toMatchObject({
      status: 'CURRENT',
    });
  });

  it('refuses a record that cannot be decoded as a project', async () => {
    await seed(new Map([['not', 'json']]));
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toMatchObject({
      status: 'REFUSED',
    });
  });

  it('refuses a pre-version record once a canonical generation was recorded (§2.7 contradiction)', async () => {
    await seed(current());
    await idbProjectCanonicalAuthority.commitCanonicalProjectEdit({
      expectedGeneration: (
        (await idbProjectCanonicalAuthority.loadCanonicalProjectAdmission()) as {
          generation: string;
        }
      ).generation,
      edit: { fields: { title: 'Committed' } },
    });
    const { schemaVersion: _omit, ...legacy } = current();
    await seed(legacy);

    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toMatchObject({
      status: 'REFUSED',
    });
  });

  it('reports nothing stored as absent', async () => {
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'ABSENT',
    });
  });
});
