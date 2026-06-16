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

// QNBS-v3: Rebrand — canonical worldscript-* IndexedDB namespace. Safe to rename outright:
// local-first sync is behind enableLocalFirstSync (off by default) and this is a pre-release
// shadow store with no existing installs, so no migration from the old storycraft-* name is needed.
const DB_PREFIX = 'worldscript-localfirst-';

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

/** In-memory-only handle: no IndexedDB persistence (unavailable, or deliberately skipped). */
export const NOOP_PERSISTENCE: DocPersistence = {
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

  let provider: IndexeddbPersistence;
  try {
    provider = new IndexeddbPersistence(dbNameForProject(projectId), doc);
  } catch {
    // QNBS-v3 (CodeAnt): some environments expose `indexedDB` but reject access (private/restricted
    // mode), so construction can throw. Honor the no-op fallback rather than breaking the app.
    return NOOP_PERSISTENCE;
  }

  // QNBS-v3 (CodeAnt): memoize the real teardown promise so concurrent/repeat calls share the SAME
  // in-flight destroy (no double-destroy, and no flag flipped to "destroyed" before destroy actually
  // finishes). Errors are swallowed so teardown never throws.
  let destroyPromise: Promise<void> | null = null;
  const destroy = (): Promise<void> => {
    if (!destroyPromise) destroyPromise = provider.destroy().catch(() => undefined);
    return destroyPromise;
  };

  // QNBS-v3 (CodeAnt): if IndexedDB fails *asynchronously* after construction, provider.whenSynced
  // rejects. Without handling, callers would receive a rejected promise and the provider would leak.
  // Downgrade to the no-op guarantee instead: tear the provider down and resolve (never reject the
  // caller), so the shadow-sync layer keeps running against Redux without a dangling provider.
  const whenSynced = provider.whenSynced.then(
    () => undefined,
    () => destroy(),
  );

  return {
    whenSynced,
    // QNBS-v3 (CodeAnt): `active` must reflect the live state — false once teardown has begun (incl.
    // the async whenSynced-rejection path), not a constant true.
    get active() {
      return destroyPromise === null;
    },
    destroy,
    // After teardown the provider can no longer clear its store — degrade to a resolved no-op.
    clearData: () =>
      destroyPromise ? Promise.resolve() : provider.clearData().catch(() => undefined),
  };
}
