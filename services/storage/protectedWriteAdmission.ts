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
  resolve: () => void;
}
let fallbackActiveShared = 0;
let fallbackExclusiveHeld = false;
const fallbackWaiters: FallbackWaiter[] = [];

function fallbackHasQueuedExclusive(): boolean {
  return fallbackWaiters.some((waiter) => waiter.mode === 'exclusive');
}

function fallbackWakeNext(): void {
  if (fallbackWaiters.length === 0) return;
  if (fallbackWaiters[0]!.mode === 'exclusive') {
    fallbackWaiters.shift()!.resolve();
    return;
  }
  while (fallbackWaiters.length > 0 && fallbackWaiters[0]!.mode === 'shared') {
    fallbackWaiters.shift()!.resolve();
  }
}

async function acquireFallback(mode: FallbackMode): Promise<() => void> {
  while (
    fallbackExclusiveHeld ||
    (mode === 'exclusive' && fallbackActiveShared > 0) ||
    (mode === 'shared' && fallbackHasQueuedExclusive())
  ) {
    await new Promise<void>((resolve) => fallbackWaiters.push({ mode, resolve }));
  }
  if (mode === 'exclusive') {
    fallbackExclusiveHeld = true;
    return () => {
      fallbackExclusiveHeld = false;
      fallbackWakeNext();
    };
  }
  fallbackActiveShared++;
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
