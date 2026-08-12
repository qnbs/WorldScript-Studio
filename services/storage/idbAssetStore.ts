/**
 * IdbAssetStore — Images and Binder binary assets (research PDFs, files).
 * ENCRYPTION: image and binder payloads are encrypted when optional IDB at-rest encryption is unlocked.
 * QNBS-v3: Extracted from dbService.ts. Redux keeps only asset IDs; blobs stay here.
 */

import { BINDER_ASSETS_STORE, IMAGES_STORE } from '../dbConstants';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import { makeBinderAssetIdsPrefix, makeBinderAssetStorageKey } from '../storageBackend';
import { getUserFriendlyDbError, retryDb } from './idbCore';
import { IdbSnapshotStore } from './idbSnapshotStore';
import {
  assertIdbProtectedWriteAllowed,
  assertNoActiveEncryptionMigration,
  assertSecureStorageReadable,
  idbEncryptWithKey,
  idbReadSecure,
  isEncryptedBlob,
  resolveProtectedWriteKey,
} from './storageEncryptionService';

export class IdbAssetStore extends IdbSnapshotStore {
  // --- Image Store Methods ---

  async saveImage(id: string, base64: string): Promise<void> {
    // QNBS-v3: Resolve the write key BEFORE opening the transaction — `await idbEncryptWithKey`
    //          yields the event loop, which auto-commits an already-open IDB transaction
    //          (TransactionInactiveError on put), and re-reading isIdbEncryptionReady() after any
    //          later await could race with Lock Session and silently fall back to plaintext.
    const writeKey = await resolveProtectedWriteKey();
    const payload = writeKey ? await idbEncryptWithKey(writeKey, base64) : base64;
    // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
    await assertNoActiveEncryptionMigration();
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(payload, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getImage(id: string): Promise<string | null> {
    // QNBS-v3: assertSecureStorageReadable also blocks reads during an active journal migration, not just a plain lock — the superset check needed while a journal owns lifecycle state.
    await assertSecureStorageReadable();
    const store = await this.getObjectStore(IMAGES_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      // QNBS-v3: IDBRequest.onsuccess is not awaited by the browser — an async handler whose
      //          promise rejects becomes an unhandled rejection instead of reaching this
      //          Promise's reject, leaving the caller pending instead of surfacing the error.
      request.onsuccess = () => {
        const raw = request.result;
        if (raw == null) {
          resolve(null);
          return;
        }
        // QNBS-v3: Decrypt encrypted image payload; legacy plaintext falls through.
        if (raw instanceof Uint8Array && isEncryptedBlob(raw)) {
          idbReadSecure<string>(raw).then(resolve).catch(reject);
          return;
        }
        resolve(raw as string);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteImage(id: string): Promise<void> {
    // QNBS-v3: A locked session must not be able to destroy protected images it cannot read.
    await assertIdbProtectedWriteAllowed();
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
      const writeKey = await resolveProtectedWriteKey();
      const key = makeBinderAssetStorageKey(projectId, assetId);
      const fullMeta = { ...meta, byteSize: data.byteLength };
      // QNBS-v3: idbEncrypt serialises via JSON.stringify, which silently drops a Blob ({} → no data).
      //          When encrypting, persist the raw bytes; otherwise store a structured-clone-friendly Blob.
      const payload = writeKey
        ? await idbEncryptWithKey(writeKey, {
            meta: fullMeta,
            bytes: Array.from(new Uint8Array(data)),
          })
        : {
            meta: fullMeta,
            blob: new Blob([data], { type: meta.mimeType || 'application/octet-stream' }),
          };
      // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
      await assertNoActiveEncryptionMigration();
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
      // QNBS-v3: superset of the lock check — also blocks reads during an active journal migration.
      await assertSecureStorageReadable();
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
      // QNBS-v3: A locked session must not be able to destroy protected binder assets it cannot read.
      await assertIdbProtectedWriteAllowed();
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
      // QNBS-v3: Binder asset ids are metadata about protected content — use the superset check so a locked session, or an active journal migration, can't enumerate them either.
      await assertSecureStorageReadable();
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
    return retryDb(async () => {
      await assertIdbProtectedWriteAllowed();
      const ids = await this.listBinderAssetIds(projectId);
      if (ids.length === 0) return;
      // QNBS-v3: one transaction for every delete, not one transaction PER asset — a later failure
      //          aborts the whole batch (IDB rolls back everything already queued in it) instead of
      //          leaving earlier assets permanently removed while later ones and the project record
      //          survive. All requests are queued synchronously below the store fetch so IDB never
      //          auto-commits the transaction mid-batch.
      const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readwrite');
      const transaction = store.transaction;
      return new Promise<void>((resolve, reject) => {
        let failure: string | undefined;
        for (const id of ids) {
          const request = store.delete(makeBinderAssetStorageKey(projectId, id));
          request.onerror = () => {
            failure = getUserFriendlyDbError(request.error);
            transaction.abort();
          };
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(failure ?? getUserFriendlyDbError(transaction.error));
      });
    });
  }
}
