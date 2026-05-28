/**
 * services/storage/index.ts — Composite IndexedDBService assembling all domain stores.
 * QNBS-v3: IndexedDBService is a thin type-alias class; all methods live in the store chain.
 * Import `dbService` from here (or via the backward-compat re-export in services/dbService.ts).
 */

import type { StorageBackend } from '../storageBackend';
import { IdbProjectStore } from './idbProjectStore';

// Final composite class — all domain methods inherited from the store chain:
// IdbConnectionManager → IdbKeyStore → IdbCodexStore → IdbSnapshotStore → IdbAssetStore → IdbProjectStore
export class IndexedDBService extends IdbProjectStore implements StorageBackend {}

export const dbService: IndexedDBService = new IndexedDBService();

export { IdbAssetStore } from './idbAssetStore';
export { IdbCodexStore } from './idbCodexStore';
// Re-export shared utilities for callers that previously imported directly from dbService.ts
export {
  compressData,
  decompressData,
  getUserFriendlyDbError,
  IdbConnectionManager,
  retryDb,
} from './idbCore';
export { IdbKeyStore } from './idbKeyStore';
export { IdbProjectStore } from './idbProjectStore';
export { IdbSnapshotStore } from './idbSnapshotStore';
