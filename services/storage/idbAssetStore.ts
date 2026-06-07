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
import {
  idbEncrypt,
  idbReadSecure,
  isEncryptedBlob,
  isIdbEncryptionReady,
} from './storageEncryptionService';

export class IdbAssetStore extends IdbSnapshotStore {
  // --- Image Store Methods ---

  async saveImage(id: string, base64: string): Promise<void> {
    // QNBS-v3: Encrypt BEFORE opening the transaction — `await idbEncrypt` yields the event loop,
    //          which auto-commits an already-open IDB transaction (TransactionInactiveError on put).
    const payload = isIdbEncryptionReady() ? await idbEncrypt(base64) : base64;
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(payload, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getImage(id: string): Promise<string | null> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = async () => {
        const raw = request.result;
        if (raw == null) {
          resolve(null);
          return;
        }
        // QNBS-v3: Decrypt encrypted image payload; legacy plaintext falls through.
        if (raw instanceof Uint8Array && isEncryptedBlob(raw)) {
          resolve(await idbReadSecure<string>(raw));
          return;
        }
        resolve(raw as string);
      };
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
      const fullMeta = { ...meta, byteSize: data.byteLength };
      // QNBS-v3: idbEncrypt serialises via JSON.stringify, which silently drops a Blob ({} → no data).
      //          When encrypting, persist the raw bytes; otherwise store a structured-clone-friendly Blob.
      const payload = isIdbEncryptionReady()
        ? await idbEncrypt({ meta: fullMeta, bytes: Array.from(new Uint8Array(data)) })
        : {
            meta: fullMeta,
            blob: new Blob([data], { type: meta.mimeType || 'application/octet-stream' }),
          };
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const req = store.put(payload, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
    });
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    return retryDb(async () => {
      const key = makeBinderAssetStorageKey(projectId, assetId);
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readonly');
      const raw = await new Promise<unknown>((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
      if (!raw) return null;
      // QNBS-v3: Encrypted payloads carry raw bytes (Blobs aren't JSON-serialisable); plaintext
      //          payloads carry a Blob. Reconstruct an ArrayBuffer from whichever shape is present.
      if (raw instanceof Uint8Array && isEncryptedBlob(raw)) {
        const dec = await idbReadSecure<{ meta: BinderAssetMeta; bytes: number[] }>(raw);
        return { data: new Uint8Array(dec.bytes).buffer, meta: dec.meta };
      }
      const record = raw as { meta: BinderAssetMeta; blob: Blob };
      if (!record?.blob) return null;
      const data = await record.blob.arrayBuffer();
      return { data, meta: record.meta };
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
