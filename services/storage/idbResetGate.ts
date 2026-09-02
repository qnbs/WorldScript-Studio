/**
 * idbResetGate — shared "reset in progress" signal + connection-closer registry.
 *
 * Every module that caches a long-lived IDBDatabase handle registers its own closer here once,
 * at module load, so factory reset can close all of them from one place instead of each new
 * store needing its own hand-wired close-for-reset export and manual wiring into
 * factoryResetService.ts. The gate additionally blocks an in-flight or new open from caching a
 * connection while a reset is underway — closing the race where an open that started before
 * beginIdbReset() ran completes afterward and repopulates a connection factory reset already
 * closed, which would otherwise let deleteDatabase() block again.
 */

let resetInProgress = false;
const closers = new Set<() => void>();

/** Registers a closer, called once per module at load time. Returns an unregister function for tests. */
export function registerIdbConnectionCloser(closer: () => void): () => void {
  closers.add(closer);
  return () => closers.delete(closer);
}

/** Every module that caches an IDBDatabase handle must check this before caching a newly opened one. */
export function isIdbResetInProgress(): boolean {
  return resetInProgress;
}

/** Marks a reset as in progress and closes every registered connection. */
export function beginIdbReset(): void {
  resetInProgress = true;
  for (const close of closers) close();
}

/** Only needed if a reset attempt fails before reaching reload — restores normal DB access. */
export function endIdbReset(): void {
  resetInProgress = false;
}

/** Test-only: clears the registry between test files so leftover closers from one test don't fire in another. */
export function _resetIdbResetGateForTest(): void {
  resetInProgress = false;
  closers.clear();
}
