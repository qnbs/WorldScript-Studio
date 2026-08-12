/**
 * Cross-tab admission for protected-store writes vs. an active encryption migration.
 * QNBS-v3: replaces the standalone-read assertNoActiveEncryptionMigration() preflight, which left a race window between a writer's key resolution and its transaction commit, with real mutual exclusion.
 */

import { createLogger } from '../logger';

const LOCK_NAME = 'worldscript:idb-protected-write-v1';
const logger = createLogger('protectedWriteAdmission');

let warnedNoLocksApi = false;

function hasLocksApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

// QNBS-v3: in-process fallback reader/writer lock for runtimes without navigator.locks — same-tab-only mutual exclusion, weaker than Web Locks (no cross-tab), but strictly better than running unguarded.
type FallbackMode = 'shared' | 'exclusive';
interface FallbackWaiter {
  mode: FallbackMode;
  grant: () => void;
}
let fallbackActiveShared = 0;
let fallbackExclusiveHeld = false;
const fallbackWaiters: FallbackWaiter[] = [];

function fallbackHasQueuedExclusive(): boolean {
  return fallbackWaiters.some((waiter) => waiter.mode === 'exclusive');
}

// QNBS-v3: claims ownership synchronously, in the same statement that decides the lock is free — a caller can never observe a moment where the lock looks free but no one has claimed it yet.
function fallbackTryClaim(mode: FallbackMode): boolean {
  if (fallbackExclusiveHeld) return false;
  if (mode === 'exclusive') {
    if (fallbackActiveShared > 0) return false;
    fallbackExclusiveHeld = true;
    return true;
  }
  if (fallbackHasQueuedExclusive()) return false;
  fallbackActiveShared++;
  return true;
}

// QNBS-v3: also claims ownership synchronously before grant() resolves the waiter's promise, so release-then-wake can never leave a gap where a fresh caller barges in ahead of an already-woken waiter.
function fallbackWakeNext(): void {
  if (fallbackWaiters.length === 0) return;
  if (fallbackWaiters[0]!.mode === 'exclusive') {
    fallbackExclusiveHeld = true;
    fallbackWaiters.shift()!.grant();
    return;
  }
  while (fallbackWaiters.length > 0 && fallbackWaiters[0]!.mode === 'shared') {
    fallbackActiveShared++;
    fallbackWaiters.shift()!.grant();
  }
}

async function acquireFallback(mode: FallbackMode): Promise<() => void> {
  if (!fallbackTryClaim(mode)) {
    // QNBS-v3: fallbackWakeNext() already claimed ownership on this waiter's behalf before calling grant() — no re-check needed here.
    await new Promise<void>((grant) => fallbackWaiters.push({ mode, grant }));
  }
  if (mode === 'exclusive') {
    return () => {
      fallbackExclusiveHeld = false;
      fallbackWakeNext();
    };
  }
  return () => {
    fallbackActiveShared--;
    if (fallbackActiveShared === 0) fallbackWakeNext();
  };
}

async function withFallbackAdmission<T>(mode: FallbackMode, fn: () => Promise<T>): Promise<T> {
  if (!warnedNoLocksApi) {
    warnedNoLocksApi = true;
    logger.warn('navigator.locks unavailable — using an in-process (same-tab only) fallback lock');
  }
  const release = await acquireFallback(mode);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Ordinary protected writers hold this in shared mode for their full key-resolution-through-
 * transaction-commit span. Many shared holders can run concurrently; an exclusive migration
 * admission (below) waits for all of them to release before it is granted, and blocks new shared
 * requests until it releases — a standard fair reader/writer lock via the browser's own scheduler.
 */
export async function withProtectedWriteAdmission<T>(fn: () => Promise<T>): Promise<T> {
  if (!hasLocksApi()) return withFallbackAdmission('shared', fn);
  return navigator.locks.request(LOCK_NAME, { mode: 'shared' }, () => fn());
}

/**
 * A migration batch holds this in exclusive mode only for the span of one adapter.migrateNext()
 * call (~batchSize records), not the whole migration run — bounding writer starvation while still
 * making the store's actual read-transform-write atomic with respect to every ordinary writer.
 */
export async function withMigrationAdmission<T>(fn: () => Promise<T>): Promise<T> {
  if (!hasLocksApi()) return withFallbackAdmission('exclusive', fn);
  return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, () => fn());
}
