// services/localFirst/docPersistence.ts
//
// QNBS-v3: B1.1 — offline persistence for the shadow project Y.Doc via y-indexeddb. One IndexedDB
// database per project (separate from the main app DBs) so the experimental local-first store is
// isolated and trivially wipeable. Guarded for non-browser / no-IndexedDB environments (SSR, some
// Tauri webviews) — there it degrades to a no-op rather than throwing.
//
// QNBS-v3 (CodeAnt — raw-IndexedDB rule): this module IS the centralized abstraction for local-first
// persistence — the single chokepoint that touches IndexedDB for this feature, mirroring the existing
// per-subsystem IDB wrappers (services/logger.ts log sink, services/proForge/proForgeMemoryBank.ts,
// services/ai/aiInferenceCacheService.ts). It deliberately does NOT route through StorageBackend:
// that interface is a high-level project/key-value API (saveProject/saveSettings/saveRagVectors…),
// whereas y-indexeddb's IndexeddbPersistence owns a Yjs CRDT *update-log* store and must manage its
// own connection — there is no StorageBackend method it could use.

import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

const DB_PREFIX = 'storycraft-localfirst-';

/** IndexedDB database name for a project's shadow doc. */
export function dbNameForProject(projectId: string): string {
  return `${DB_PREFIX}${projectId}`;
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export interface DocPersistence {
  /** Resolves once the on-disk state has loaded into the doc (or immediately if unavailable). */
  readonly whenSynced: Promise<void>;
  /** Whether real IndexedDB persistence is active (false = no-op fallback). */
  readonly active: boolean;
  /** Detach the provider (does not delete data). */
  destroy(): Promise<void>;
  /** Delete the persisted data for this project. */
  clearData(): Promise<void>;
}

const NOOP_PERSISTENCE: DocPersistence = {
  whenSynced: Promise.resolve(),
  active: false,
  destroy: () => Promise.resolve(),
  clearData: () => Promise.resolve(),
};

/**
 * Attach y-indexeddb persistence to a project doc. Returns a no-op handle when IndexedDB is
 * unavailable so callers never need to branch.
 */
export function persistProjectDoc(projectId: string, doc: Y.Doc): DocPersistence {
  if (!isIndexedDbAvailable()) return NOOP_PERSISTENCE;

  const provider = new IndexeddbPersistence(dbNameForProject(projectId), doc);
  return {
    whenSynced: provider.whenSynced.then(() => undefined),
    active: true,
    destroy: () => provider.destroy(),
    clearData: () => provider.clearData(),
  };
}
