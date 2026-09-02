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

/** Test-only: closes dbService's cached IDB connections so a freshly-installed IDBFactory takes effect. */
export function _resetDbForTest(): void {
  (dbService as unknown as { closeConnections: () => void }).closeConnections();
}

// QNBS-v3: factory reset's deleteDatabase() silently treated onblocked as success while this
// connection stayed open, leaving the database intact after a reported-successful reset (#532).
/** Closes dbService's own cached IDB connections before a factory reset's deleteDatabase calls, so they are not blocked by this same page's still-open connection. */
export function closeDbServiceConnectionsForReset(): void {
  (dbService as unknown as { closeConnections: () => void }).closeConnections();
}

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
export * from './idbPassphraseSentinel';
export { IdbProjectStore } from './idbProjectStore';
export { IdbSnapshotStore } from './idbSnapshotStore';
