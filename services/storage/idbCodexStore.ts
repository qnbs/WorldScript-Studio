/**
 * IdbCodexStore — Codex entries and RAG vector embeddings.
 * ENCRYPTION: plaintext — codex entries are project content; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from dbService.ts.
 */

import type { StoryCodex } from '../../types';
import { CODEX_STORE, RAG_VECTORS_STORE } from '../dbConstants';
import { compressData, decompressData } from './idbCore';
import { IdbKeyStore } from './idbKeyStore';
import {
  idbDecrypt,
  idbEncrypt,
  isEncryptedBlob,
  isIdbEncryptionReady,
} from './storageEncryptionService';

export class IdbCodexStore extends IdbKeyStore {
  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    // QNBS-v3: Encrypt/compress BEFORE opening the IDB transaction — `await idbEncrypt` yields the
    //          event loop, which auto-commits an already-open transaction (TransactionInactiveError).
    const processed = isIdbEncryptionReady() ? await idbEncrypt(codex) : compressData(codex);
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
    const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    const store = await this.getObjectStore(CODEX_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(projectId);
      request.onsuccess = async () => {
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
          if (isEncryptedBlob(bytes) && isIdbEncryptionReady()) {
            resolve(await idbDecrypt<StoryCodex>(bytes));
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
    const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- RAG Vector Methods ---

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    // QNBS-v3: Encrypt BEFORE opening the transaction — `await idbEncrypt` yields the event loop and
    //          would auto-commit the open transaction before the put (TransactionInactiveError).
    const encryptedPayload = isIdbEncryptionReady()
      ? Array.from(await idbEncrypt({ projectId, vectors }))
      : null;
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
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    const store = await this.getObjectStore(RAG_VECTORS_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.index('projectId').getAll(projectId);
      req.onsuccess = async () => {
        const results = req.result as unknown[];
        // QNBS-v3: Check for encrypted blob wrapper (single record with _enc flag)
        if (results.length === 1) {
          const first = results[0] as { _enc?: boolean; encrypted?: number[] } | undefined;
          if (first?._enc && first.encrypted) {
            const bytes = new Uint8Array(first.encrypted);
            if (isEncryptedBlob(bytes) && isIdbEncryptionReady()) {
              const decrypted = await idbDecrypt<{ vectors: unknown[] }>(bytes);
              resolve(decrypted.vectors);
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
