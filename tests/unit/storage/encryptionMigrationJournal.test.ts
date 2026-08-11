// @vitest-environment node
// QNBS-v3: Real fake IndexedDB verifies the journal transaction and cross-instance behavior.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEncryptionMigrationJournalConnectionsForTest,
  assertNoActiveEncryptionMigration,
  beginEncryptionMigration,
  clearCompletedEncryptionMigration,
  completeEncryptionMigration,
  IdbMigrationInProgressError,
  IdbMigrationOwnershipError,
  readEncryptionMigrationJournal,
  updateEncryptionMigrationJournal,
} from '../../../services/storage/encryptionMigrationJournal';
import { IdbProjectStore } from '../../../services/storage/idbProjectStore';
import type { Settings } from '../../../types';

const migrationInput = (operationId: string) => ({
  operationId,
  operation: 'rekey' as const,
  phase: 'prepared' as const,
  sourceGeneration: 'source-generation',
  targetGeneration: 'target-generation',
  targetVerifier: [1, 2, 3],
  stores: [
    {
      id: 'worldscript-state-db/app-data-store',
      processed: 0,
      verified: 0,
      done: false,
    },
  ],
});

beforeEach(() => {
  __resetEncryptionMigrationJournalConnectionsForTest();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  __resetEncryptionMigrationJournalConnectionsForTest();
});

describe('encryption migration journal', () => {
  it('durably persists versioned, non-secret migration metadata', async () => {
    const created = await beginEncryptionMigration(migrationInput('operation-1'));
    const restored = await readEncryptionMigrationJournal();

    expect(created.schemaVersion).toBe(1);
    expect(created.revision).toBe(0);
    expect(restored).toMatchObject({
      operationId: 'operation-1',
      operation: 'rekey',
      phase: 'prepared',
      targetVerifier: [1, 2, 3],
    });
    expect(restored?.startedAt).toBeTypeOf('number');
    expect(restored?.updatedAt).toBeTypeOf('number');
  });

  it('rejects a competing migration owner and blocks protected access until terminal completion', async () => {
    const created = await beginEncryptionMigration(migrationInput('operation-1'));

    await expect(beginEncryptionMigration(migrationInput('operation-2'))).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );
    await expect(assertNoActiveEncryptionMigration()).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );
    await expect(new IdbProjectStore().saveSettings({} as Settings)).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );

    await completeEncryptionMigration(created);
    await expect(assertNoActiveEncryptionMigration()).resolves.toBeUndefined();
  });

  it('allows a completed journal to be cleared before a later migration begins', async () => {
    const first = await beginEncryptionMigration(migrationInput('operation-1'));
    await completeEncryptionMigration(first);
    await clearCompletedEncryptionMigration();

    await expect(beginEncryptionMigration(migrationInput('operation-2'))).resolves.toMatchObject({
      operationId: 'operation-2',
    });
  });

  it('rejects a delayed owner instead of overwriting a newer checkpoint', async () => {
    const created = await beginEncryptionMigration(migrationInput('operation-1'));
    const updated = await updateEncryptionMigrationJournal(created, {
      phase: 'migrating',
      stores: [
        {
          ...created.stores[0],
          cursor: 'project/settings',
          processed: 1,
          verified: 1,
          done: false,
        },
      ],
    });

    await expect(
      updateEncryptionMigrationJournal(created, {
        phase: 'verifying',
        stores: created.stores,
      }),
    ).rejects.toBeInstanceOf(IdbMigrationOwnershipError);
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      operationId: 'operation-1',
      phase: 'migrating',
      revision: updated.revision,
      stores: [{ cursor: 'project/settings', processed: 1, verified: 1, done: false }],
    });
  });

  it('never clears an active journal during completed-state cleanup', async () => {
    await beginEncryptionMigration(migrationInput('operation-1'));

    await expect(clearCompletedEncryptionMigration()).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      operationId: 'operation-1',
      phase: 'prepared',
    });
  });
});
