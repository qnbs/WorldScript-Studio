/**
 * idbResetGate — shared "reset in progress" signal + async connection-closer registry, with a
 * generation/epoch invariant so a connection open that started before or during a reset can never
 * become cached/authoritative after that reset, even if the reset later fails and resetInProgress
 * flips back to false.
 *
 * Every module that caches a long-lived IDBDatabase handle registers its own (possibly async)
 * closer here once, at load time. beginIdbReset() awaits every registered closer's teardown —
 * including any closer registered WHILE the drain is still running — before settling, and fails
 * closed: if any closer threw or rejected, beginIdbReset() itself rejects so the caller (factory
 * reset) never proceeds into destructive database deletion on an unproven teardown.
 */

// QNBS-v3: logger is dynamically imported, never at module top level — a static import here creates a load-time circular dependency with services/diagnostics/logSinks.ts, one of the StructuredLogger's own sink-chain modules.

export type IdbConnectionCloser = () => void | Promise<void>;

let resetInProgress = false;
let generation = 0;
const closers = new Set<IdbConnectionCloser>();

interface ResetBarrier {
  pending: Set<Promise<void>>;
  failures: unknown[];
}

// QNBS-v3: set only while beginIdbReset() is draining — lets a closer registered mid-reset join THIS reset's awaited barrier instead of racing ahead of it as a fire-and-forget.
let activeBarrier: ResetBarrier | null = null;

async function runCloser(closer: IdbConnectionCloser): Promise<void> {
  await closer();
}

// QNBS-v3: settled removes itself from barrier.pending via its own .then — safe because that callback only runs on a later microtask, after the synchronous `const settled = …` assignment below has completed.
function joinActiveBarrier(closer: IdbConnectionCloser): void {
  const barrier = activeBarrier;
  if (!barrier) return;
  const settled: Promise<void> = runCloser(closer)
    .catch((error: unknown) => {
      barrier.failures.push(error);
    })
    .then(() => {
      barrier.pending.delete(settled);
    });
  barrier.pending.add(settled);
}

/**
 * Registers a closer, called once per module at load time. If a reset is already in progress,
 * the closer joins that reset's own awaited barrier immediately instead of waiting for a future
 * one — a connection opened mid-reset must not survive that same reset, and beginIdbReset() must
 * not settle until this late closer has also settled. Returns an unregister function (used by
 * modules whose connection lifetime is shorter than the app's, e.g. per-project y-indexeddb docs,
 * and by tests).
 */
export function registerIdbConnectionCloser(closer: IdbConnectionCloser): () => void {
  closers.add(closer);
  if (resetInProgress) {
    joinActiveBarrier(closer);
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
 * teardown — including any closer registered WHILE this drain is still running, via the same
 * barrier. Fails closed: if any closer threw or rejected, this rejects too (after every closer,
 * including the failing ones, has had its chance to run) so the caller never proceeds into
 * destructive deletion on an unproven teardown. The reset stays marked in progress either way —
 * it is the caller's responsibility to call endIdbReset() once it decides whether to proceed with
 * deletion or abort.
 */
export async function beginIdbReset(): Promise<void> {
  resetInProgress = true;
  generation += 1;
  const barrier: ResetBarrier = { pending: new Set(), failures: [] };
  activeBarrier = barrier;
  for (const closer of closers) {
    joinActiveBarrier(closer);
  }
  // QNBS-v3: re-checks pending after each drain round — a closer registered while we're draining adds itself to this same Set, so the loop only exits once nothing new has joined.
  while (barrier.pending.size > 0) {
    await Promise.allSettled(Array.from(barrier.pending));
  }
  activeBarrier = null;
  if (barrier.failures.length > 0) {
    const messages = barrier.failures.map((failure) =>
      failure instanceof Error ? failure.message : String(failure),
    );
    const { logger } = await import('../logger');
    logger.warn(
      `[idbResetGate] ${barrier.failures.length} connection closer(s) failed during reset`,
      {
        errors: messages,
      },
    );
    throw new Error(
      `[idbResetGate] reset teardown incomplete — ${barrier.failures.length} closer(s) failed: ${messages.join('; ')}`,
    );
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
  activeBarrier = null;
}
