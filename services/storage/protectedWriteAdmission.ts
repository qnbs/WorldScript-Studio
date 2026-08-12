/**
 * Cross-tab admission for protected-store writes vs. an active encryption migration.
 * QNBS-v3: assertNoActiveEncryptionMigration() alone is a standalone read — a migration can claim
 *          ownership and commit in the gap between a writer's key resolution and its transaction
 *          commit. Web Locks gives every protected writer/migration batch real mutual exclusion
 *          instead of a preflight check with a race window.
 */

import { createLogger } from '../logger';

const LOCK_NAME = 'worldscript:idb-protected-write-v1';
const logger = createLogger('protectedWriteAdmission');

let warnedNoLocksApi = false;

function hasLocksApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

/**
 * Ordinary protected writers hold this in shared mode for their full key-resolution-through-
 * transaction-commit span. Many shared holders can run concurrently; an exclusive migration
 * admission (below) waits for all of them to release before it is granted, and blocks new shared
 * requests until it releases — a standard fair reader/writer lock via the browser's own scheduler.
 */
export async function withProtectedWriteAdmission<T>(fn: () => Promise<T>): Promise<T> {
  if (!hasLocksApi()) {
    if (!warnedNoLocksApi) {
      warnedNoLocksApi = true;
      logger.warn('navigator.locks unavailable — protected writes are not migration-admitted');
    }
    return fn();
  }
  return navigator.locks.request(LOCK_NAME, { mode: 'shared' }, () => fn());
}

/**
 * A migration batch holds this in exclusive mode only for the span of one adapter.migrateNext()
 * call (~batchSize records), not the whole migration run — bounding writer starvation while still
 * making the store's actual read-transform-write atomic with respect to every ordinary writer.
 */
export async function withMigrationAdmission<T>(fn: () => Promise<T>): Promise<T> {
  if (!hasLocksApi()) {
    if (!warnedNoLocksApi) {
      warnedNoLocksApi = true;
      logger.warn('navigator.locks unavailable — migration batches are not write-admitted');
    }
    return fn();
  }
  return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, () => fn());
}
