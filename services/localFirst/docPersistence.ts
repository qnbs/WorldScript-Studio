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
import { isIdbResetInProgress, registerIdbConnectionCloser } from '../storage/idbResetGate';

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
  // QNBS-v3: never open a fresh y-indexeddb provider while a reset is draining — it would immediately register a closer and get torn down again, for no benefit, and could race the reset's own deleteDatabase call.
  if (isIdbResetInProgress()) return NOOP_PERSISTENCE;

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
  // QNBS-v3: starts as a no-op and gets replaced right after registration — a reset already in progress would otherwise invoke this closer synchronously while unregister is still mid-TDZ.
  let unregister: () => void = () => {};
  const destroy = (): Promise<void> => {
    if (!destroyPromise) {
      unregister();
      destroyPromise = provider.destroy().catch(() => undefined);
    }
    return destroyPromise;
  };
  // QNBS-v3: this project's own worldscript-localfirst-<id> connection must close during a factory reset too, or deleteDatabase blocks on it — each open project doc registers/unregisters its own instance. Returns destroy()'s own promise (a block-bodied arrow here would silently discard it, so the reset gate would resolve before teardown actually finished).
  unregister = registerIdbConnectionCloser(() => destroy());

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
