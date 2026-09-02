/**
 * idbResetGate — shared "reset in progress" signal + async connection-closer registry, with a
 * generation/epoch invariant so a connection open that started before or during a reset can never
 * become cached/authoritative after that reset, even if the reset later fails and resetInProgress
 * flips back to false.
 *
 * Every module that caches a long-lived IDBDatabase handle registers its own (possibly async)
 * closer here once, at load time. beginIdbReset() awaits every registered closer's teardown
 * before resolving, so factory reset only starts deleting databases once every known connection
 * has actually finished closing — not merely been asked to.
 */

// QNBS-v3: logger is dynamically imported, never at module top level — a static import here creates a load-time circular dependency with services/diagnostics/logSinks.ts, one of the StructuredLogger's own sink-chain modules.

export type IdbConnectionCloser = () => void | Promise<void>;

let resetInProgress = false;
let generation = 0;
const closers = new Set<IdbConnectionCloser>();

async function runCloser(closer: IdbConnectionCloser): Promise<void> {
  await closer();
}

/**
 * Registers a closer, called once per module at load time. If a reset is already in progress,
 * the closer is invoked immediately against the current reset instead of waiting for a future
 * one — a connection opened mid-reset must not survive that same reset. Returns an unregister
 * function (used by modules whose connection lifetime is shorter than the app's, e.g. per-project
 * y-indexeddb docs, and by tests).
 */
export function registerIdbConnectionCloser(closer: IdbConnectionCloser): () => void {
  closers.add(closer);
  if (resetInProgress) {
    void runCloser(closer).catch(async (error: unknown) => {
      const { logger } = await import('../logger');
      logger.warn('[idbResetGate] late-registered closer failed during an active reset', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return () => closers.delete(closer);
}

/** Every module that caches an IDBDatabase handle should consult this before starting a new open. */
export function isIdbResetInProgress(): boolean {
  return resetInProgress;
}

/**
 * Every module's open-completion handler must capture this at the START of an open attempt, then
 * compare it again at completion: `capturedGeneration !== currentIdbResetGeneration()` means a
 * reset happened (and possibly already ended) since the open began, so the result must be closed
 * and discarded rather than cached — this is the authoritative check, stricter than
 * isIdbResetInProgress(), which cannot distinguish "no reset ever happened" from "a reset
 * happened, failed, and ended" once the boolean flips back to false.
 */
export function currentIdbResetGeneration(): number {
  return generation;
}

/**
 * Marks a reset in progress and advances the generation synchronously (before anything else
 * async runs, so no new open can slip in unobserved), then awaits every registered closer's
 * teardown. A closer that throws or rejects is logged, fails closed (the reset stays marked in
 * progress; it is the caller's responsibility to decide whether to proceed with deletion or abort
 * and call endIdbReset()), and never silently stops the other closers from running.
 */
export async function beginIdbReset(): Promise<void> {
  resetInProgress = true;
  generation += 1;
  const results = await Promise.allSettled(Array.from(closers, runCloser));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    const { logger } = await import('../logger');
    logger.warn(`[idbResetGate] ${failures.length} connection closer(s) failed during reset`, {
      errors: failures.map((failure) =>
        failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
      ),
    });
  }
}

/** Only needed if a reset attempt fails before reaching reload — restores normal DB access for the still-live app. */
export function endIdbReset(): void {
  resetInProgress = false;
}

/** Test-only: clears the registry and generation between test files so leftover closers from one test don't fire in another. */
export function _resetIdbResetGateForTest(): void {
  resetInProgress = false;
  generation = 0;
  closers.clear();
}
