/**
 * Combines every registered primary and secondary protected-store adapter into one production
 * at-rest-encryption migration run. QNBS-v3: the only production caller of
 * beginEncryptionMigration/runProtectedStoreMigration — see storageEncryptionService.ts's
 * clearIdbPassphrase/rotateIdbPassphrase for how the caller commits the result.
 */

import {
  beginEncryptionMigration,
  type EncryptionMigrationJournal,
  type EncryptionMigrationOperation,
} from './encryptionMigrationJournal';
import { getRegisteredPrimaryProtectedStoreAdapters } from './primaryProtectedStoreAdapters';
import {
  type EncryptionMigrationKeys,
  type ProtectedStoreAdapter,
  type ProtectedStoreMigrationProgressCallback,
  runProtectedStoreMigration,
} from './protectedStoreMigration';
import { getRegisteredSecondaryProtectedStoreAdapters } from './secondaryProtectedStoreAdapters';

export type {
  ProtectedStoreMigrationProgress,
  ProtectedStoreMigrationProgressCallback,
} from './protectedStoreMigration';

function getRegisteredProtectedStoreAdapters(): readonly ProtectedStoreAdapter[] {
  return [
    ...getRegisteredPrimaryProtectedStoreAdapters(),
    ...getRegisteredSecondaryProtectedStoreAdapters(),
  ];
}

function createMigrationOperationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface StartProductionEncryptionMigrationInput {
  operation: EncryptionMigrationOperation;
  keys: EncryptionMigrationKeys;
  /** A verifier encrypted with the target key — required for 'enable'/'rekey', omitted for 'disable'. */
  targetVerifier?: number[];
  onProgress?: ProtectedStoreMigrationProgressCallback;
}

/**
 * Starts a fresh production migration across every registered store and runs it through to the
 * 'committing' phase. Throws IdbMigrationInProgressError if a journal is already active — callers
 * must resolve that (resume via resumeProductionEncryptionMigration, or surface recovery UX)
 * rather than starting a second, conflicting migration.
 */
export async function runProductionEncryptionMigration(
  input: StartProductionEncryptionMigrationInput,
): Promise<EncryptionMigrationJournal> {
  const adapters = getRegisteredProtectedStoreAdapters();
  const journal = await beginEncryptionMigration({
    operationId: createMigrationOperationId(),
    operation: input.operation,
    phase: 'prepared',
    ...(input.targetVerifier ? { targetVerifier: input.targetVerifier } : {}),
    stores: adapters.map((adapter) => ({ id: adapter.id, processed: 0, verified: 0, done: false })),
  });
  return runProtectedStoreMigration(journal, adapters, input.keys, input.onProgress);
}

/**
 * Resumes an already-active journal (e.g. after a page reload interrupted a prior run) using
 * freshly supplied keys — CryptoKey material is never persisted, so the recovery UX must re-derive
 * it from the user's passphrase(s) before calling this.
 */
export async function resumeProductionEncryptionMigration(
  journal: EncryptionMigrationJournal,
  keys: EncryptionMigrationKeys,
  onProgress?: ProtectedStoreMigrationProgressCallback,
): Promise<EncryptionMigrationJournal> {
  return runProtectedStoreMigration(
    journal,
    getRegisteredProtectedStoreAdapters(),
    keys,
    onProgress,
  );
}
