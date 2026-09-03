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

// QNBS-v3: a fresh object every call, deliberately never the NOOP_PERSISTENCE singleton — this is a transient "reset denied this open" result, not an intentional environmental NOOP, so a caller that caches it (getLocalFirstHandle's reconcileLocalFirstHandle) can tell the two apart by identity and must not keep reusing it once the reset ends.
function createTransientResetDeniedPersistence(): DocPersistence {
  return {
    whenSynced: Promise.resolve(),
    active: false,
    destroy: () => Promise.resolve(),
    clearData: () => Promise.resolve(),
  };
}

/**
 * Attach y-indexeddb persistence to a project doc. Returns a no-op handle when IndexedDB is
 * unavailable so callers never need to branch.
 */
export function persistProjectDoc(projectId: string, doc: Y.Doc): DocPersistence {
  if (!isIndexedDbAvailable()) return NOOP_PERSISTENCE;
  // QNBS-v3: never open a fresh y-indexeddb provider while a reset is draining — it would immediately register a closer and get torn down again, for no benefit, and could race the reset's own deleteDatabase call.
  if (isIdbResetInProgress()) return createTransientResetDeniedPersistence();

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
  // finishes).
  let rawDestroyPromise: Promise<void> | null = null;
  // QNBS-v3: starts as a no-op and gets replaced right after registration — a reset already in progress would otherwise invoke this closer synchronously while unregister is still mid-TDZ.
  let unregister: () => void = () => {};
  // QNBS-v3 (CodeAnt): unregisters only once the underlying teardown actually settles, not synchronously before it starts — a reset draining right after this call would otherwise no longer track (and never await) a still-in-flight destroy.
  const beginDestroy = (): Promise<void> => {
    if (!rawDestroyPromise) {
      rawDestroyPromise = provider.destroy();
      rawDestroyPromise.finally(unregister).catch(() => undefined);
    }
    return rawDestroyPromise;
  };
  // QNBS-v3 (CodeAnt): the public destroy() stays no-throw for its many defensive `.catch(() => undefined)` callers, but the reset closer below calls beginDestroy() directly so a genuine teardown failure still reaches the reset gate's fail-closed check instead of being swallowed before it gets there.
  const destroy = (): Promise<void> => beginDestroy().catch(() => undefined);
  // QNBS-v3: this project's own worldscript-localfirst-<id> connection must close during a factory reset too, or deleteDatabase blocks on it — each open project doc registers/unregisters its own instance.
  unregister = registerIdbConnectionCloser(() => beginDestroy());

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
      return rawDestroyPromise === null;
    },
    destroy,
    // After teardown the provider can no longer clear its store — degrade to a resolved no-op.
    clearData: () =>
      rawDestroyPromise ? Promise.resolve() : provider.clearData().catch(() => undefined),
  };
}
