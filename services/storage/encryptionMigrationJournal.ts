/**
 * Durable coordination metadata for multi-store at-rest encryption migrations.
 * A journal is deliberately plaintext metadata: it never contains passphrases or CryptoKeys.
 */

import { APP_DATA_STORE } from '../dbConstants';
import { IdbConnectionManager } from './idbCore';

const JOURNAL_RECORD_KEY = '__idb_encryption_migration_journal_v1__';
const JOURNAL_SCHEMA_VERSION = 1;

export type EncryptionMigrationOperation = 'enable' | 'rekey' | 'disable';
export type EncryptionMigrationPhase =
  | 'prepared'
  | 'migrating'
  | 'verifying'
  | 'committing'
  | 'cleanup'
  | 'completed'
  | 'recovery-required';

export interface EncryptionMigrationStoreCheckpoint {
  id: string;
  /** Last durably committed logical record id; omitted before the first successful batch. */
  cursor?: string;
  processed: number;
  verified: number;
  done: boolean;
}

export interface EncryptionMigrationJournal {
  schemaVersion: number;
  operationId: string;
  /** Monotone compare-and-swap token; it is independent from wall-clock precision. */
  revision: number;
  operation: EncryptionMigrationOperation;
  phase: EncryptionMigrationPhase;
  startedAt: number;
  updatedAt: number;
  sourceGeneration?: string;
  targetGeneration?: string;
  /** A verifier encrypted with the target key, never raw key material. */
  targetVerifier?: number[];
  stores: EncryptionMigrationStoreCheckpoint[];
}

export class IdbMigrationInProgressError extends Error {
  readonly code = 'ENCRYPTION_MIGRATION_IN_PROGRESS' as const;

  constructor(journal: EncryptionMigrationJournal) {
    super(`Encryption ${journal.operation} migration is ${journal.phase}`);
    this.name = 'IdbMigrationInProgressError';
  }
}

export class IdbMigrationRecoveryRequiredError extends Error {
  readonly code = 'ENCRYPTION_RECOVERY_REQUIRED' as const;

  constructor() {
    super('Encryption migration metadata is invalid and requires recovery');
    this.name = 'IdbMigrationRecoveryRequiredError';
  }
}

/** Raised when a delayed tab tries to overwrite a newer durable journal state. */
export class IdbMigrationOwnershipError extends Error {
  readonly code = 'ENCRYPTION_MIGRATION_OWNERSHIP_LOST' as const;

  constructor() {
    super('Encryption migration journal ownership was lost');
    this.name = 'IdbMigrationOwnershipError';
  }
}

function isPhase(value: unknown): value is EncryptionMigrationPhase {
  return (
    value === 'prepared' ||
    value === 'migrating' ||
    value === 'verifying' ||
    value === 'committing' ||
    value === 'cleanup' ||
    value === 'completed' ||
    value === 'recovery-required'
  );
}

function isOperation(value: unknown): value is EncryptionMigrationOperation {
  return value === 'enable' || value === 'rekey' || value === 'disable';
}

function parseJournal(raw: unknown): EncryptionMigrationJournal | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<EncryptionMigrationJournal>;
  const revision = value.revision ?? 0;
  if (
    value.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    typeof value.operationId !== 'string' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !isOperation(value.operation) ||
    !isPhase(value.phase) ||
    typeof value.startedAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !Array.isArray(value.stores)
  ) {
    return null;
  }
  if (
    value.stores.some(
      (checkpoint) =>
        !checkpoint ||
        typeof checkpoint.id !== 'string' ||
        (checkpoint.cursor !== undefined && typeof checkpoint.cursor !== 'string') ||
        typeof checkpoint.processed !== 'number' ||
        typeof checkpoint.verified !== 'number' ||
        typeof checkpoint.done !== 'boolean',
    )
  ) {
    return null;
  }
  if (
    value.targetVerifier &&
    !value.targetVerifier.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return null;
  }
  // QNBS-v3: Pre-CAS journals are safely upgraded in memory and persist a revision on their next write.
  return { ...value, revision } as EncryptionMigrationJournal;
}

function journalIsActive(journal: EncryptionMigrationJournal): boolean {
  return journal.phase !== 'completed';
}

class EncryptionMigrationJournalStore extends IdbConnectionManager {
  async read(): Promise<EncryptionMigrationJournal | null> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(JOURNAL_RECORD_KEY);
      request.onsuccess = () => {
        if (request.result === undefined) {
          resolve(null);
          return;
        }
        const journal = parseJournal(request.result);
        if (!journal) {
          reject(new IdbMigrationRecoveryRequiredError());
          return;
        }
        resolve(journal);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async begin(journal: EncryptionMigrationJournal): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const existingRequest = store.get(JOURNAL_RECORD_KEY);
      existingRequest.onerror = () => reject(existingRequest.error);
      existingRequest.onsuccess = () => {
        if (existingRequest.result !== undefined) {
          const existing = parseJournal(existingRequest.result);
          if (!existing) {
            reject(new IdbMigrationRecoveryRequiredError());
            return;
          }
          if (journalIsActive(existing)) {
            reject(new IdbMigrationInProgressError(existing));
            return;
          }
        }
        const putRequest = store.put(journal, JOURNAL_RECORD_KEY);
        putRequest.onerror = () => reject(putRequest.error);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Journal transaction aborted'));
    });
  }

  async saveIfCurrent(journal: EncryptionMigrationJournal): Promise<EncryptionMigrationJournal> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    const next: EncryptionMigrationJournal = {
      ...journal,
      revision: journal.revision + 1,
      updatedAt: Date.now(),
    };
    return new Promise((resolve, reject) => {
      let writeQueued = false;
      const existingRequest = store.get(JOURNAL_RECORD_KEY);
      existingRequest.onerror = () => reject(existingRequest.error);
      existingRequest.onsuccess = () => {
        const existing = parseJournal(existingRequest.result);
        if (
          !existing ||
          existing.operationId !== journal.operationId ||
          existing.revision !== journal.revision
        ) {
          reject(new IdbMigrationOwnershipError());
          return;
        }
        const putRequest = store.put(next, JOURNAL_RECORD_KEY);
        putRequest.onerror = () => reject(putRequest.error);
        writeQueued = true;
      };
      transaction.oncomplete = () => {
        if (writeQueued) resolve(next);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Journal transaction aborted'));
    });
  }

  async clearCompleted(): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const existingRequest = store.get(JOURNAL_RECORD_KEY);
      existingRequest.onerror = () => reject(existingRequest.error);
      existingRequest.onsuccess = () => {
        if (existingRequest.result === undefined) return;
        const existing = parseJournal(existingRequest.result);
        if (!existing) {
          reject(new IdbMigrationRecoveryRequiredError());
          return;
        }
        if (journalIsActive(existing)) {
          reject(new IdbMigrationInProgressError(existing));
          return;
        }
        const deleteRequest = store.delete(JOURNAL_RECORD_KEY);
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Journal transaction aborted'));
    });
  }

  resetConnectionsForTest(): void {
    this.closeConnections();
  }
}

const journalStore = new EncryptionMigrationJournalStore();

export async function readEncryptionMigrationJournal(): Promise<EncryptionMigrationJournal | null> {
  return journalStore.read();
}

export async function beginEncryptionMigration(
  input: Omit<EncryptionMigrationJournal, 'schemaVersion' | 'revision' | 'startedAt' | 'updatedAt'>,
): Promise<EncryptionMigrationJournal> {
  const now = Date.now();
  const journal: EncryptionMigrationJournal = {
    ...input,
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    revision: 0,
    startedAt: now,
    updatedAt: now,
  };
  await journalStore.begin(journal);
  return journal;
}

export async function updateEncryptionMigrationJournal(
  journal: EncryptionMigrationJournal,
  changes: Pick<EncryptionMigrationJournal, 'phase' | 'stores'>,
): Promise<EncryptionMigrationJournal> {
  return journalStore.saveIfCurrent({ ...journal, ...changes });
}

export async function completeEncryptionMigration(
  journal: EncryptionMigrationJournal,
): Promise<void> {
  await journalStore.saveIfCurrent({ ...journal, phase: 'completed' });
}

export async function clearCompletedEncryptionMigration(): Promise<void> {
  await journalStore.clearCompleted();
}

/** Reject normal protected access while a cross-store migration is not in a terminal state. */
export async function assertNoActiveEncryptionMigration(): Promise<void> {
  const journal = await journalStore.read();
  if (journal && journalIsActive(journal)) {
    throw new IdbMigrationInProgressError(journal);
  }
}

export const __encryptionMigrationJournalRecordKeyForTest = JOURNAL_RECORD_KEY;

/** Test-only reset so a new fake IndexedDB factory cannot reuse stale singleton connections. */
export function __resetEncryptionMigrationJournalConnectionsForTest(): void {
  journalStore.resetConnectionsForTest();
}
