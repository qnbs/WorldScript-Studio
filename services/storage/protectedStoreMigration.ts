/**
 * Journal-owned execution protocol for protected-store adapters.
 * QNBS-v3: Cross-database IndexedDB work is a resumable saga, never a pretend global transaction.
 */

import {
  claimEncryptionMigrationOwnership,
  type EncryptionMigrationJournal,
  type EncryptionMigrationOperation,
  type EncryptionMigrationStoreCheckpoint,
  releaseEncryptionMigrationOwnership,
  updateEncryptionMigrationJournal,
} from './encryptionMigrationJournal';
import { assertIdbMigrationTargetKeyMatchesVerifier } from './storageEncryptionService';

export interface EncryptionMigrationKeys {
  sourceKey?: CryptoKey;
  targetKey?: CryptoKey;
}

export interface ProtectedStoreMigrationBatch {
  /** Last logical id durably written by this batch; omit only before any record was committed. */
  cursor?: string;
  processed: number;
  complete: boolean;
}

export interface ProtectedStoreAdapterContext extends EncryptionMigrationKeys {
  operation: EncryptionMigrationOperation;
  cursor?: string;
}

export interface ProtectedStoreAdapter {
  id: string;
  /** Required because a crash can occur after a store transaction commits but before its journal checkpoint. */
  replaySafe: true;
  /** Converts one bounded, transaction-confirmed batch. */
  migrateNext(context: ProtectedStoreAdapterContext): Promise<ProtectedStoreMigrationBatch>;
  /** Reads every relevant record under the post-migration policy without changing storage. */
  verify(context: Omit<ProtectedStoreAdapterContext, 'cursor'>): Promise<number>;
}

export class ProtectedStoreMigrationAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedStoreMigrationAdapterError';
  }
}

function checkpointFor(
  journal: EncryptionMigrationJournal,
  adapterId: string,
): EncryptionMigrationStoreCheckpoint {
  const checkpoint = journal.stores.find((candidate) => candidate.id === adapterId);
  if (!checkpoint) {
    throw new ProtectedStoreMigrationAdapterError(
      `Migration journal is missing the registered store checkpoint ${adapterId}`,
    );
  }
  return checkpoint;
}

function replaceCheckpoint(
  journal: EncryptionMigrationJournal,
  replacement: EncryptionMigrationStoreCheckpoint,
): EncryptionMigrationStoreCheckpoint[] {
  return journal.stores.map((checkpoint) =>
    checkpoint.id === replacement.id ? replacement : checkpoint,
  );
}

function nextCheckpoint(
  checkpoint: EncryptionMigrationStoreCheckpoint,
  batch: ProtectedStoreMigrationBatch,
): EncryptionMigrationStoreCheckpoint {
  if (!Number.isSafeInteger(batch.processed) || batch.processed < 0) {
    throw new ProtectedStoreMigrationAdapterError(
      `Store ${checkpoint.id} returned invalid progress`,
    );
  }
  if (!batch.complete && batch.processed === 0) {
    throw new ProtectedStoreMigrationAdapterError(
      `Store ${checkpoint.id} made no progress without completing`,
    );
  }
  const cursor = batch.cursor ?? checkpoint.cursor;
  return {
    ...checkpoint,
    ...(cursor !== undefined ? { cursor } : {}),
    processed: checkpoint.processed + batch.processed,
    done: batch.complete,
  };
}

function migrationContext(
  journal: EncryptionMigrationJournal,
  checkpoint: EncryptionMigrationStoreCheckpoint,
  keys: EncryptionMigrationKeys,
): ProtectedStoreAdapterContext {
  return {
    operation: journal.operation,
    ...(checkpoint.cursor !== undefined ? { cursor: checkpoint.cursor } : {}),
    ...(keys.sourceKey ? { sourceKey: keys.sourceKey } : {}),
    ...(keys.targetKey ? { targetKey: keys.targetKey } : {}),
  };
}

function yieldAfterCheckpoint(): Promise<void> {
  // QNBS-v3: WebCrypto/IDB batches must yield so migration progress never monopolizes the renderer event loop.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertRegisteredAdapters(
  journal: EncryptionMigrationJournal,
  adapters: readonly ProtectedStoreAdapter[],
): void {
  const ids = new Set(adapters.map((adapter) => adapter.id));
  const checkpointIds = new Set(journal.stores.map((checkpoint) => checkpoint.id));
  if (ids.size !== adapters.length) {
    throw new ProtectedStoreMigrationAdapterError('Protected-store adapter ids must be unique');
  }
  if (checkpointIds.size !== journal.stores.length) {
    throw new ProtectedStoreMigrationAdapterError(
      'Migration journal store checkpoint ids must be unique',
    );
  }
  if (adapters.some((adapter) => adapter.replaySafe !== true)) {
    throw new ProtectedStoreMigrationAdapterError(
      'Every protected-store adapter must explicitly guarantee replay-safe batches',
    );
  }
  for (const checkpoint of journal.stores) {
    if (!ids.has(checkpoint.id)) {
      throw new ProtectedStoreMigrationAdapterError(
        `No registered protected-store adapter exists for ${checkpoint.id}`,
      );
    }
  }
  for (const adapter of adapters) {
    if (!checkpointIds.has(adapter.id)) {
      throw new ProtectedStoreMigrationAdapterError(
        `Registered protected-store adapter ${adapter.id} is missing from the migration journal`,
      );
    }
  }
}

function assertRequiredKeys(
  operation: EncryptionMigrationOperation,
  keys: EncryptionMigrationKeys,
): void {
  if (operation === 'enable' && !keys.targetKey) {
    throw new ProtectedStoreMigrationAdapterError('Enable migration requires a target key');
  }
  if (operation === 'disable' && !keys.sourceKey) {
    throw new ProtectedStoreMigrationAdapterError('Disable migration requires a source key');
  }
  if (operation === 'rekey' && (!keys.sourceKey || !keys.targetKey)) {
    throw new ProtectedStoreMigrationAdapterError(
      'Rekey migration requires source and target keys',
    );
  }
}

async function assertTargetKeyMatchesJournal(
  journal: EncryptionMigrationJournal,
  keys: EncryptionMigrationKeys,
): Promise<void> {
  if (journal.operation === 'disable') return;
  if (!keys.targetKey || !journal.targetVerifier || journal.targetVerifier.length === 0) {
    throw new ProtectedStoreMigrationAdapterError(
      'Enable and rekey migrations require an authenticated target verifier',
    );
  }
  try {
    await assertIdbMigrationTargetKeyMatchesVerifier(keys.targetKey, journal.targetVerifier);
  } catch {
    throw new ProtectedStoreMigrationAdapterError(
      'Migration target key does not match the durable target verifier',
    );
  }
}

function createMigrationOwnerId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert all registered stores and checkpoint each durable batch. The returned journal is in
 * `committing`; only the caller that can atomically change verifier metadata may complete it.
 */
export async function runProtectedStoreMigration(
  initialJournal: EncryptionMigrationJournal,
  adapters: readonly ProtectedStoreAdapter[],
  keys: EncryptionMigrationKeys,
): Promise<EncryptionMigrationJournal> {
  let journal = initialJournal;
  if (journal.phase === 'recovery-required') {
    throw new ProtectedStoreMigrationAdapterError(
      'Recovery-required journal cannot run until an explicit recovery procedure validates it',
    );
  }
  assertRegisteredAdapters(journal, adapters);
  assertRequiredKeys(journal.operation, keys);
  let ownsLease = false;
  try {
    // QNBS-v3: Claim before the first adapter mutation so two tabs cannot transform the same batch concurrently.
    journal = await claimEncryptionMigrationOwnership(journal, createMigrationOwnerId());
    ownsLease = true;
    await assertTargetKeyMatchesJournal(journal, keys);
    if (journal.phase === 'prepared') {
      journal = await updateEncryptionMigrationJournal(journal, {
        phase: 'migrating',
        stores: journal.stores,
      });
    }
    if (
      journal.phase !== 'migrating' &&
      journal.phase !== 'verifying' &&
      journal.phase !== 'committing'
    ) {
      throw new ProtectedStoreMigrationAdapterError(
        `Cannot execute protected-store migration from ${journal.phase}`,
      );
    }

    if (journal.phase === 'migrating') {
      for (const adapter of adapters) {
        let checkpoint = checkpointFor(journal, adapter.id);
        while (!checkpoint.done) {
          const batch = await adapter.migrateNext(migrationContext(journal, checkpoint, keys));
          checkpoint = nextCheckpoint(checkpoint, batch);
          journal = await updateEncryptionMigrationJournal(journal, {
            phase: 'migrating',
            stores: replaceCheckpoint(journal, checkpoint),
          });
          await yieldAfterCheckpoint();
        }
      }
      journal = await updateEncryptionMigrationJournal(journal, {
        phase: 'verifying',
        stores: journal.stores,
      });
    }

    if (journal.phase === 'verifying') {
      for (const adapter of adapters) {
        const checkpoint = checkpointFor(journal, adapter.id);
        if (checkpoint.done && checkpoint.verified >= checkpoint.processed) continue;
        const verified = await adapter.verify({
          operation: journal.operation,
          ...(keys.sourceKey ? { sourceKey: keys.sourceKey } : {}),
          ...(keys.targetKey ? { targetKey: keys.targetKey } : {}),
        });
        if (!Number.isSafeInteger(verified) || verified < checkpoint.processed) {
          throw new ProtectedStoreMigrationAdapterError(
            `Store ${adapter.id} verification is incomplete`,
          );
        }
        journal = await updateEncryptionMigrationJournal(journal, {
          phase: 'verifying',
          stores: replaceCheckpoint(journal, { ...checkpoint, verified }),
        });
      }
      journal = await updateEncryptionMigrationJournal(journal, {
        phase: 'committing',
        stores: journal.stores,
      });
    }

    return journal;
  } catch (error) {
    if (ownsLease && journal.phase !== 'committing') {
      try {
        await releaseEncryptionMigrationOwnership(journal);
      } catch {
        // QNBS-v3: A lost lease must never overwrite a newer recovery owner's durable state.
      }
    }
    throw error;
  }
}
