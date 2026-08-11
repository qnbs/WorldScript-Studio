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
  processed: number;
  verified: number;
  done: boolean;
}

export interface EncryptionMigrationJournal {
  schemaVersion: number;
  operationId: string;
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
  if (
    value.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    typeof value.operationId !== 'string' ||
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
  return value as EncryptionMigrationJournal;
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

  async save(journal: EncryptionMigrationJournal): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const request = store.put(journal, JOURNAL_RECORD_KEY);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Journal transaction aborted'));
    });
  }

  async delete(): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const request = store.delete(JOURNAL_RECORD_KEY);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Journal transaction aborted'));
    });
  }
}

const journalStore = new EncryptionMigrationJournalStore();

export async function readEncryptionMigrationJournal(): Promise<EncryptionMigrationJournal | null> {
  return journalStore.read();
}

export async function beginEncryptionMigration(
  input: Omit<EncryptionMigrationJournal, 'schemaVersion' | 'startedAt' | 'updatedAt'>,
): Promise<EncryptionMigrationJournal> {
  const now = Date.now();
  const journal: EncryptionMigrationJournal = {
    ...input,
    schemaVersion: JOURNAL_SCHEMA_VERSION,
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
  const updated: EncryptionMigrationJournal = {
    ...journal,
    ...changes,
    updatedAt: Date.now(),
  };
  await journalStore.save(updated);
  return updated;
}

export async function completeEncryptionMigration(
  journal: EncryptionMigrationJournal,
): Promise<void> {
  await journalStore.save({ ...journal, phase: 'completed', updatedAt: Date.now() });
}

export async function clearCompletedEncryptionMigration(): Promise<void> {
  const journal = await journalStore.read();
  if (!journal || journal.phase === 'completed') {
    await journalStore.delete();
    return;
  }
  throw new IdbMigrationInProgressError(journal);
}

/** Reject normal protected access while a cross-store migration is not in a terminal state. */
export async function assertNoActiveEncryptionMigration(): Promise<void> {
  const journal = await journalStore.read();
  if (journal && journalIsActive(journal)) {
    throw new IdbMigrationInProgressError(journal);
  }
}

export const __encryptionMigrationJournalRecordKeyForTest = JOURNAL_RECORD_KEY;
