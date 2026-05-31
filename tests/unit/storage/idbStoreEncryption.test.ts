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

import { IdbAssetStore } from '../../../services/storage/idbAssetStore';
import { IdbCodexStore } from '../../../services/storage/idbCodexStore';
import {
  clearIdbEncryptionKey,
  initIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

beforeEach(() => {
  // QNBS-v3: fresh, isolated IndexedDB per test (stores are instantiated per test, so each gets a
  //          clean connection). Avoids cross-test record/connection leakage in the shared DB names.
  globalThis.indexedDB = new IDBFactory();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

afterEach(() => {
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
