// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-functional indexedDB stub from tests/setup.ts.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Mock localStorage for salt
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
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

import type { ProjectData } from '../../../features/project/projectState';
import { IdbAssetStore } from '../../../services/storage/idbAssetStore';
import { IdbCodexStore } from '../../../services/storage/idbCodexStore';
import { deletePassphraseSentinel } from '../../../services/storage/idbPassphraseSentinel';
import { IdbProjectStore } from '../../../services/storage/idbProjectStore';
import {
  clearIdbEncryptionKey,
  IdbStorageLockedError,
  initIdbEncryption,
  setupIdbEncryption,
} from '../../../services/storage/storageEncryptionService';
import type { Settings } from '../../../types';

beforeEach(() => {
  // QNBS-v3: fresh, isolated IndexedDB per test (stores are instantiated per test, so each gets a
  //          clean connection). Avoids cross-test record/connection leakage in the shared DB names.
  globalThis.indexedDB = new IDBFactory();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

afterEach(async () => {
  // QNBS-v3: The sentinel uses a singleton connection, so clear its durable record between libraries.
  await deletePassphraseSentinel();
  clearIdbEncryptionKey();
});

describe('IdbCodexStore encryption round-trip', () => {
  it('round-trips codex when encryption is active', async () => {
    await initIdbEncryption('test-pass');
    const store = new IdbCodexStore();
    const codex = {
      projectId: 'proj-1',
      extractedAt: '2026-05-31T00:00:00.000Z',
      entities: [
        { id: 'c1', name: 'Alice', type: 'character', known: true, mentionCount: 1, mentions: [] },
      ],
      summary: 'Test codex',
    };
    await store.saveStoryCodex(codex as import('../../../types').StoryCodex);
    const result = await store.getStoryCodex('proj-1');
    expect(result).toEqual(codex);
  });

  it('round-trips codex when encryption is inactive', async () => {
    const store = new IdbCodexStore();
    const codex = {
      projectId: 'proj-2',
      extractedAt: '2026-05-31T00:00:00.000Z',
      entities: [],
      summary: '',
    };
    await store.saveStoryCodex(codex as import('../../../types').StoryCodex);
    const result = await store.getStoryCodex('proj-2');
    expect(result).toEqual(codex);
  });

  it('round-trips RAG vectors when encryption is active', async () => {
    await initIdbEncryption('test-pass');
    const store = new IdbCodexStore();
    const vectors = [{ id: 'v1', embedding: [0.1, 0.2] }];
    await store.saveRagVectors('proj-1', vectors);
    const result = await store.getRagVectors('proj-1');
    expect(result).toEqual(vectors);
  });

  it('round-trips RAG vectors when encryption is inactive', async () => {
    const store = new IdbCodexStore();
    const vectors = [{ id: 'v1', embedding: [0.1, 0.2] }];
    await store.saveRagVectors('proj-2', vectors);
    const result = await store.getRagVectors('proj-2');
    // QNBS-v3: the unencrypted path stamps each vector with its projectId (used by the projectId index).
    expect(result).toEqual([{ id: 'v1', embedding: [0.1, 0.2], projectId: 'proj-2' }]);
  });
});

describe('IdbAssetStore encryption round-trip', () => {
  it('round-trips image when encryption is active', async () => {
    await initIdbEncryption('test-pass');
    const store = new IdbAssetStore();
    const base64 = 'data:image/png;base64,iVBORw0KGgo=';
    await store.saveImage('img-1', base64);
    const result = await store.getImage('img-1');
    expect(result).toBe(base64);
  });

  it('round-trips image when encryption is inactive', async () => {
    const store = new IdbAssetStore();
    const base64 = 'data:image/png;base64,plain=';
    await store.saveImage('img-2', base64);
    const result = await store.getImage('img-2');
    expect(result).toBe(base64);
  });

  it('round-trips binder asset when encryption is active', async () => {
    await initIdbEncryption('test-pass');
    const store = new IdbAssetStore();
    const data = new ArrayBuffer(8);
    const meta = { mimeType: 'application/pdf', originalFileName: 'test.pdf', byteSize: 8 };
    await store.saveBinderAsset('proj-1', 'asset-1', data, meta);
    const result = await store.getBinderAsset('proj-1', 'asset-1');
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual(meta);
    expect(result!.data.byteLength).toBe(8);
  });

  it('round-trips binder asset when encryption is inactive', async () => {
    const store = new IdbAssetStore();
    const data = new ArrayBuffer(8);
    const meta = { mimeType: 'application/pdf', originalFileName: 'test.pdf', byteSize: 8 };
    await store.saveBinderAsset('proj-2', 'asset-1', data, meta);
    const result = await store.getBinderAsset('proj-2', 'asset-1');
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual(meta);
    expect(result!.data.byteLength).toBe(8);
  });
});

describe('configured but locked storage', () => {
  it('does not persist protected plaintext while encryption is configured but locked', async () => {
    await setupIdbEncryption('test-pass');
    clearIdbEncryptionKey();

    const projectStore = new IdbProjectStore();
    const codexStore = new IdbCodexStore();
    const assetStore = new IdbAssetStore();
    const project = { manuscript: [] } as unknown as ProjectData;

    await expect(projectStore.saveSettings({} as Settings)).rejects.toBeInstanceOf(
      IdbStorageLockedError,
    );
    await expect(projectStore.createSnapshot(project)).rejects.toBeInstanceOf(
      IdbStorageLockedError,
    );
    await expect(
      codexStore.saveStoryCodex({
        projectId: 'locked',
        entities: [],
      } as unknown as import('../../../types').StoryCodex),
    ).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(codexStore.saveRagVectors('locked', [])).rejects.toBeInstanceOf(
      IdbStorageLockedError,
    );
    await expect(
      assetStore.saveImage('locked', 'data:image/png;base64,blocked'),
    ).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(
      assetStore.saveBinderAsset('locked', 'asset', new ArrayBuffer(0), {
        byteSize: 0,
        mimeType: 'application/pdf',
        originalFileName: 'blocked.pdf',
      }),
    ).rejects.toBeInstanceOf(IdbStorageLockedError);
  });

  it('does not expose legacy protected content while the configured library is locked', async () => {
    const assetStore = new IdbAssetStore();
    const codexStore = new IdbCodexStore();
    await assetStore.saveImage('legacy-image', 'data:image/png;base64,legacy');
    await assetStore.saveBinderAsset('legacy', 'legacy-asset', new ArrayBuffer(1), {
      byteSize: 1,
      mimeType: 'application/pdf',
      originalFileName: 'legacy.pdf',
    });
    await codexStore.saveStoryCodex({
      projectId: 'legacy',
      entities: [],
    } as unknown as import('../../../types').StoryCodex);
    await codexStore.saveRagVectors('legacy', [{ id: 'legacy-vector' }]);

    await setupIdbEncryption('test-pass');
    clearIdbEncryptionKey();

    await expect(assetStore.getImage('legacy-image')).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(assetStore.getBinderAsset('legacy', 'legacy-asset')).rejects.toBeInstanceOf(
      IdbStorageLockedError,
    );
    await expect(codexStore.getStoryCodex('legacy')).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(codexStore.getRagVectors('legacy')).rejects.toBeInstanceOf(IdbStorageLockedError);
  });
});

describe('settings restart persistence', () => {
  it('restores a persisted non-sepia appearance preset from a fresh store instance', async () => {
    const savedSettings = {
      appearancePreset: 'default',
      writingSurfaceStyle: 'plain',
    } as Settings;
    const firstStore = new IdbProjectStore();

    await firstStore.saveSettings(savedSettings);

    const restartedStore = new IdbProjectStore();
    await expect(restartedStore.loadSettings()).resolves.toMatchObject({
      appearancePreset: 'default',
      writingSurfaceStyle: 'plain',
    });
  });
});
