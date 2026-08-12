/**
 * IdbCodexStore — Codex entries and RAG vector embeddings.
 * ENCRYPTION: plaintext — codex entries are project content; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from dbService.ts.
 */

import type { StoryCodex } from '../../types';
import { CODEX_STORE, RAG_VECTORS_STORE } from '../dbConstants';
import { compressData, decompressData } from './idbCore';
import { IdbKeyStore } from './idbKeyStore';
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

export class IdbCodexStore extends IdbKeyStore {
  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: Resolve the write key BEFORE opening the transaction — `await idbEncryptWithKey`
      //          yields the event loop, which auto-commits an already-open transaction
      //          (TransactionInactiveError), and re-reading isIdbEncryptionReady() after any later
      //          await could race with Lock Session and silently fall back to plaintext.
      const writeKey = await resolveProtectedWriteKey();
      const processed = writeKey ? await idbEncryptWithKey(writeKey, codex) : compressData(codex);
      // QNBS-v3: three shapes — encrypted Uint8Array, LZ-compressed string, or (small codex) the raw
      //          object. compressData() returns the original object when JSON is below the compress
      //          threshold, so the previous `Array.from(processed as Uint8Array)` turned a small,
      //          unencrypted codex into [] — silent data loss for new/small projects (encryption OFF,
      //          the default). Keep the raw-object path so small codexes round-trip via decompressData.
      let record: object;
      if (processed instanceof Uint8Array) {
        record = { projectId: codex.projectId, encrypted: Array.from(processed) };
      } else if (typeof processed === 'string') {
        record = { projectId: codex.projectId, compressedUtf16: processed };
      } else {
        record = processed as object;
      }
      // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
      await assertNoActiveEncryptionMigration();
      const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    await assertSecureStorageReadable();
    const store = await this.getObjectStore(CODEX_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(projectId);
      request.onsuccess = () => {
        const raw = request.result;
        if (!raw) {
          resolve(null);
          return;
        }
        // QNBS-v3: Decrypt encrypted codex payload; legacy plaintext falls through decompressData.
        if (
          typeof raw === 'object' &&
          raw !== null &&
          'encrypted' in raw &&
          Array.isArray((raw as { encrypted: unknown }).encrypted)
        ) {
          const bytes = new Uint8Array((raw as { encrypted: number[] }).encrypted);
          if (isEncryptedBlob(bytes)) {
            void idbReadSecure<StoryCodex>(bytes).then(resolve, reject);
            return;
          }
        }
        if (
          typeof raw === 'object' &&
          raw !== null &&
          'compressedUtf16' in raw &&
          typeof (raw as { compressedUtf16: unknown }).compressedUtf16 === 'string'
        ) {
          resolve(decompressData<StoryCodex>((raw as { compressedUtf16: string }).compressedUtf16));
          return;
        }
        resolve(decompressData<StoryCodex>(raw));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: A locked session must not be able to destroy protected codex records it cannot read.
      await assertIdbProtectedWriteAllowed();
      const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(projectId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  // --- RAG Vector Methods ---

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: Resolve the write key BEFORE opening the transaction — `await idbEncryptWithKey`
      //          yields the event loop and would auto-commit the open transaction before the put
      //          (TransactionInactiveError), and re-reading isIdbEncryptionReady() after any later
      //          await could race with Lock Session and silently fall back to plaintext.
      const writeKey = await resolveProtectedWriteKey();
      const encryptedPayload = writeKey
        ? Array.from(await idbEncryptWithKey(writeKey, { projectId, vectors }))
        : null;
      // QNBS-v3: only the migration guard is re-checked here — the lock check already happened atomically inside resolveProtectedWriteKey(); this function's multiple sequential IDB ops (clear then write) still leave a residual window, but re-running the lock check too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
      await assertNoActiveEncryptionMigration();
      const store = await this.getObjectStore(RAG_VECTORS_STORE, 'readwrite');
      // Clear existing vectors for this project then write the full set
      const index = store.index('projectId');
      const keysToDelete: IDBValidKey[] = [];
      await new Promise<void>((resolve, reject) => {
        const req = index.getAllKeys(projectId);
        req.onsuccess = () => {
          keysToDelete.push(...(req.result as IDBValidKey[]));
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      for (const key of keysToDelete) {
        await new Promise<void>((resolve, reject) => {
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
      // QNBS-v3: Store the encrypted vector set as one blob when the session key is active.
      if (encryptedPayload) {
        await new Promise<void>((resolve, reject) => {
          // QNBS-v3: RAG_VECTORS_STORE has keyPath 'id' — the encrypted single-blob record MUST carry an
          //          id or IndexedDB throws DataError. Use a project-scoped sentinel id distinct from any
          //          real chunk id; the projectId field keeps it discoverable via the projectId index.
          const req = store.put({
            id: `__enc__:${projectId}`,
            projectId,
            encrypted: encryptedPayload,
            _enc: true,
          });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } else {
        for (const vector of vectors) {
          await new Promise<void>((resolve, reject) => {
            const req = store.put({ ...(vector as object), projectId });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        }
      }
    });
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    await assertSecureStorageReadable();
    const store = await this.getObjectStore(RAG_VECTORS_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.index('projectId').getAll(projectId);
      req.onsuccess = () => {
        const results = req.result as unknown[];
        // QNBS-v3: Check for encrypted blob wrapper (single record with _enc flag)
        if (results.length === 1) {
          const first = results[0] as { _enc?: boolean; encrypted?: number[] } | undefined;
          if (first?._enc && first.encrypted) {
            const bytes = new Uint8Array(first.encrypted);
            if (isEncryptedBlob(bytes)) {
              void idbReadSecure<{ vectors: unknown[] }>(bytes).then(
                (decrypted) => resolve(decrypted.vectors),
                reject,
              );
              return;
            }
          }
        }
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    await this.saveRagVectors(projectId, []);
  }
}
