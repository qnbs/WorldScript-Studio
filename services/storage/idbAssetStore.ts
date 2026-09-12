/**
 * IdbAssetStore — Images and Binder binary assets (research PDFs, files).
 * ENCRYPTION: image and binder payloads are encrypted when optional IDB at-rest encryption is unlocked.
 * QNBS-v3: Extracted from dbService.ts. Redux keeps only asset IDs; blobs stay here.
 */

import {
  APP_DATA_STORE,
  BINDER_ASSETS_STORE,
  IMAGES_STORE,
  LEGACY_IMAGE_OWNER_KEY,
} from '../dbConstants';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import {
  makeBinderAssetIdsPrefix,
  makeBinderAssetStorageKey,
  makeImageStorageKey,
} from '../storageBackend';
import { getUserFriendlyDbError, retryDb } from './idbCore';
import { IdbSnapshotStore } from './idbSnapshotStore';
import { withProtectedWriteAdmission } from './protectedWriteAdmission';
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

  // QNBS-v3: a legacy (pre-project-qualification) image has no recorded owner -- the first project to consult it claims the whole legacy namespace for itself, permanently; every later project is checked against that claim instead of guessing. Closes the orphaned-image leak across a New Project/import cycle that reuses the same entity id.
  private async claimOrCheckLegacyImageOwnership(projectId: string): Promise<boolean> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    // QNBS-v3: the read and the conditional write are chained inside one onsuccess callback on one readwrite transaction (no awaited gap between them), not two separate transactions -- IDB serializes concurrent readwrite transactions on the same store, so this makes claim-or-check atomic: two concurrent callers for different projects can never both observe "unclaimed" and both succeed.
    return new Promise<boolean>((resolve, reject) => {
      let result: boolean | undefined;
      const getRequest = store.get(LEGACY_IMAGE_OWNER_KEY);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        // QNBS-v3: treats both undefined (real IDB "no such key") and null (a store that records an explicit null) as unclaimed.
        const existing = getRequest.result as string | undefined;
        if (existing == null) {
          const putRequest = store.put(projectId, LEGACY_IMAGE_OWNER_KEY);
          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => {
            result = true;
          };
          return;
        }
        result = existing === projectId;
      };
      // QNBS-v3: resolves only once the transaction durably commits, not merely once the individual put request succeeds -- a request can report success and still be rolled back if the transaction later aborts, which would otherwise let getImage proceed on a claim that was never actually persisted.
      transaction.oncomplete = () => resolve(result as boolean);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  // QNBS-v3: read-only counterpart for deleteImage -- a destructive delete must never itself establish the first ownership claim, only act once ownership is already provable.
  private async checkLegacyImageOwnership(projectId: string): Promise<boolean> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const existing = await new Promise<string | undefined>((resolve, reject) => {
      const request = store.get(LEGACY_IMAGE_OWNER_KEY);
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error);
    });
    return existing === projectId;
  }

  async saveImage(id: string, base64: string, projectId = 'default'): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: Resolve the write key BEFORE opening the transaction — `await idbEncryptWithKey`
      //          yields the event loop, which auto-commits an already-open IDB transaction
      //          (TransactionInactiveError on put), and re-reading isIdbEncryptionReady() after any
      //          later await could race with Lock Session and silently fall back to plaintext.
      const writeKey = await resolveProtectedWriteKey();
      const payload = writeKey ? await idbEncryptWithKey(writeKey, base64) : base64;
      // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
      await assertNoActiveEncryptionMigration();
      const key = await makeImageStorageKey(projectId, id);
      const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const request = store.put(payload, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  // QNBS-v3: decodes one raw IMAGES_STORE record (legacy plaintext or encrypted) into its base64 string.
  private decodeImageRecord(raw: unknown): Promise<string | null> | string | null {
    if (raw == null) return null;
    if (raw instanceof Uint8Array && isEncryptedBlob(raw)) {
      return idbReadSecure<string>(raw);
    }
    return raw as string;
  }

  private getRawImage(key: string): Promise<unknown> {
    return this.getObjectStore(IMAGES_STORE, 'readonly').then(
      (store) =>
        new Promise<unknown>((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  async getImage(id: string, projectId = 'default'): Promise<string | null> {
    // QNBS-v3: assertSecureStorageReadable also blocks reads during an active journal migration, not just a plain lock — the superset check needed while a journal owns lifecycle state.
    await assertSecureStorageReadable();
    const qualified = await this.getRawImage(await makeImageStorageKey(projectId, id));
    if (qualified != null) return this.decodeImageRecord(qualified);
    // QNBS-v3: fail closed unless this project provably owns (or is first to claim) the legacy namespace -- an orphaned blob from a previously-active, now-replaced project must never be served as this project's image.
    if (!(await this.claimOrCheckLegacyImageOwnership(projectId))) return null;
    const legacy = await this.getRawImage(id);
    return this.decodeImageRecord(legacy);
  }

  async deleteImage(id: string, projectId = 'default'): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: A locked session must not be able to destroy protected images it cannot read.
      await assertIdbProtectedWriteAllowed();
      // QNBS-v3: computed BEFORE opening the transaction -- an await between getObjectStore and the delete calls would auto-commit the transaction early (same hazard noted in saveImage above).
      const qualifiedKey = await makeImageStorageKey(projectId, id);
      // QNBS-v3: only delete the legacy key when ownership is already provable -- a delete must never itself establish a first claim, unlike getImage's read-only fallback.
      const legacyOwned = await this.checkLegacyImageOwnership(projectId);
      const keysToDelete = legacyOwned ? [qualifiedKey, id] : [qualifiedKey];
      const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
      // QNBS-v3: clear both the qualified and legacy key so a stale legacy record can never resurface via getImage's fallback after an explicit delete. Both deletes share one IDB transaction, so a failure on either aborts and rolls back both -- no partial-delete resurrection risk here, unlike the filesystem backend's independent file operations.
      await Promise.all(
        keysToDelete.map(
          (key) =>
            new Promise<void>((resolve, reject) => {
              const request = store.delete(key);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    });
  }

  // QNBS-v3: qualified-only read for rollback/transaction callers -- never consults the legacy fallback (which could return a differently-provenanced blob) and never converts a genuine read failure to null; both would corrupt a rollback's snapshot of exactly the key saveImage/deleteImage mutate.
  async getQualifiedImage(id: string, projectId = 'default'): Promise<string | null> {
    await assertSecureStorageReadable();
    const qualified = await this.getRawImage(await makeImageStorageKey(projectId, id));
    return this.decodeImageRecord(qualified);
  }

  // QNBS-v3: qualified-only delete for rollback/transaction callers -- never touches the legacy key or the legacy ownership marker, unlike deleteImage's user-facing "clear both" semantics, which would delete a legacy image that predates and is unrelated to the transaction being rolled back.
  async deleteQualifiedImage(id: string, projectId = 'default'): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      await assertIdbProtectedWriteAllowed();
      const qualifiedKey = await makeImageStorageKey(projectId, id);
      const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
      const transaction = store.transaction;
      // QNBS-v3: resolves only once the transaction durably commits, not merely once the delete request succeeds -- a request can report success and still be rolled back if the transaction later aborts, which would otherwise let a rollback believe an image was removed when it was actually restored.
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(qualifiedKey);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
  }

  // QNBS-v3: Binder-Blobs in eigener IDB-Store — Redux bleibt schlank, Research-PDFs offline-first.

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    return retryDb(() =>
      withProtectedWriteAdmission(async () => {
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
      }),
    );
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
    return retryDb(() =>
      withProtectedWriteAdmission(async () => {
        // QNBS-v3: A locked session must not be able to destroy protected binder assets it cannot read.
        await assertIdbProtectedWriteAllowed();
        const key = makeBinderAssetStorageKey(projectId, assetId);
        const store = await this.getObjectStore(BINDER_ASSETS_STORE, 'readwrite');
        return new Promise<void>((resolve, reject) => {
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(getUserFriendlyDbError(req.error));
        });
      }),
    );
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
    return withProtectedWriteAdmission(() =>
      this.deleteAllBinderAssetsForProjectUnadmitted(projectId),
    );
  }

  // QNBS-v3: unwrapped core for deleteProject() to call inside its own single outer admission — nesting withProtectedWriteAdmission (same shared lock name, same call stack) can deadlock if an exclusive migration request queues between the outer and inner acquisition.
  protected async deleteAllBinderAssetsForProjectUnadmitted(projectId: string): Promise<void> {
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
