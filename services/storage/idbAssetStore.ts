/**
 * IdbAssetStore — Images and Binder binary assets (research PDFs, files).
 * ENCRYPTION: plaintext — blob storage; at-rest encryption planned for Phase 2.
 * QNBS-v3: Extracted from dbService.ts. Redux keeps only asset IDs; blobs stay here.
 */

import { BINDER_ASSETS_STORE, IMAGES_STORE } from '../dbConstants';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import { makeBinderAssetIdsPrefix, makeBinderAssetStorageKey } from '../storageBackend';
import { getUserFriendlyDbError, retryDb } from './idbCore';
import { IdbSnapshotStore } from './idbSnapshotStore';

export class IdbAssetStore extends IdbSnapshotStore {
  // --- Image Store Methods ---

  async saveImage(id: string, base64: string): Promise<void> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(base64, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getImage(id: string): Promise<string | null> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteImage(id: string): Promise<void> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // QNBS-v3: Binder-Blobs in eigener IDB-Store — Redux bleibt schlank, Research-PDFs offline-first.

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    return retryDb(async () => {
      const key = makeBinderAssetStorageKey(projectId, assetId);
      const blob = new Blob([data], { type: meta.mimeType || 'application/octet-stream' });
      const record = { meta: { ...meta, byteSize: data.byteLength }, blob };
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
    });
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    return retryDb(async () => {
      const key = makeBinderAssetStorageKey(projectId, assetId);
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readonly');
      const raw = await new Promise<{ meta: BinderAssetMeta; blob: Blob } | undefined>(
        (resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result as { meta: BinderAssetMeta; blob: Blob });
          req.onerror = () => reject(getUserFriendlyDbError(req.error));
        },
      );
      if (!raw?.blob) return null;
      const data = await raw.blob.arrayBuffer();
      return { data, meta: raw.meta };
    });
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    return retryDb(async () => {
      const key = makeBinderAssetStorageKey(projectId, assetId);
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
    });
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    return retryDb(async () => {
      const prefix = makeBinderAssetIdsPrefix(projectId);
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readonly');
      const ids: string[] = [];
      return new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const k = String(cursor.key ?? '');
            if (k.startsWith(prefix)) {
              ids.push(k.slice(prefix.length));
            }
            cursor.continue();
          } else {
            resolve(ids);
          }
        };
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
    });
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    const ids = await this.listBinderAssetIds(projectId);
    await Promise.all(ids.map((id) => this.deleteBinderAsset(projectId, id)));
  }
}
