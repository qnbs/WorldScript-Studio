// @vitest-environment node
// QNBS-v3: Failure injection proves a durable checkpoint resumes rather than replaying an ambiguous store.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEncryptionMigrationJournalConnectionsForTest,
  beginEncryptionMigration,
  readEncryptionMigrationJournal,
} from '../../../services/storage/encryptionMigrationJournal';
import {
  type ProtectedStoreAdapter,
  runProtectedStoreMigration,
} from '../../../services/storage/protectedStoreMigration';

beforeEach(() => {
  __resetEncryptionMigrationJournalConnectionsForTest();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  __resetEncryptionMigrationJournalConnectionsForTest();
});

const begin = () =>
  beginEncryptionMigration({
    operationId: 'operation-1',
    operation: 'rekey',
    phase: 'prepared',
    sourceGeneration: 'source',
    targetGeneration: 'target',
    targetVerifier: [1, 2, 3],
    stores: [{ id: 'test-store', processed: 0, verified: 0, done: false }],
  });

describe('runProtectedStoreMigration', () => {
  it('checkpoints committed batches and reaches committing only after verification', async () => {
    const calls: Array<string | undefined> = [];
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      async migrateNext({ cursor }) {
        calls.push(cursor);
        return cursor === undefined
          ? { cursor: 'record-1', processed: 1, complete: false }
          : { cursor: 'record-2', processed: 1, complete: true };
      },
      async verify() {
        return 2;
      },
    };

    const result = await runProtectedStoreMigration(await begin(), [adapter], {});

    expect(calls).toEqual([undefined, 'record-1']);
    expect(result.phase).toBe('committing');
    expect(result.stores).toEqual([
      { id: 'test-store', cursor: 'record-2', processed: 2, verified: 2, done: true },
    ]);
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      phase: 'committing',
      stores: [{ cursor: 'record-2', processed: 2, verified: 2, done: true }],
    });
  });

  it('resumes from the last durable cursor after an interrupted batch', async () => {
    const firstAttempt: ProtectedStoreAdapter = {
      id: 'test-store',
      async migrateNext() {
        return { cursor: 'record-1', processed: 1, complete: false };
      },
      async verify() {
        return 1;
      },
    };
    const interrupted = await begin();
    await expect(
      runProtectedStoreMigration(
        interrupted,
        [
          {
            ...firstAttempt,
            async migrateNext(context) {
              if (context.cursor === undefined) return firstAttempt.migrateNext(context);
              throw new Error('injected interruption');
            },
          },
        ],
        {},
      ),
    ).rejects.toThrow('injected interruption');

    const checkpoint = await readEncryptionMigrationJournal();
    expect(checkpoint).toMatchObject({
      phase: 'migrating',
      stores: [{ cursor: 'record-1', processed: 1, done: false }],
    });

    const resumedCalls: Array<string | undefined> = [];
    const resumed = await runProtectedStoreMigration(
      checkpoint!,
      [
        {
          id: 'test-store',
          async migrateNext({ cursor }) {
            resumedCalls.push(cursor);
            return { cursor: 'record-2', processed: 1, complete: true };
          },
          async verify() {
            return 2;
          },
        },
      ],
      {},
    );

    expect(resumedCalls).toEqual(['record-1']);
    expect(resumed.phase).toBe('committing');
    expect(resumed.stores[0]).toMatchObject({ cursor: 'record-2', processed: 2, verified: 2 });
  });
});
