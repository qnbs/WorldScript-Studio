/**
 * IdbCodexStore — Codex entries and RAG vector embeddings.
 * ENCRYPTION: plaintext — codex entries are project content; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from dbService.ts.
 */

import type { StoryCodex } from '../../types';
import { CODEX_STORE, RAG_VECTORS_STORE } from '../dbConstants';
import { compressData, decompressData } from './idbCore';
import { IdbKeyStore } from './idbKeyStore';

export class IdbCodexStore extends IdbKeyStore {
  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
    const processed = compressData(codex);
    const record =
      typeof processed === 'string'
        ? { projectId: codex.projectId, compressedUtf16: processed }
        : processed;
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
      request.onsuccess = () => {
        const raw = request.result;
        if (!raw) {
          resolve(null);
          return;
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
    for (const vector of vectors) {
      await new Promise<void>((resolve, reject) => {
        const req = store.put({ ...(vector as object), projectId });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    const store = await this.getObjectStore(RAG_VECTORS_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.index('projectId').getAll(projectId);
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    await this.saveRagVectors(projectId, []);
  }
}
