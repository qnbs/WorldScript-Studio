// @vitest-environment node
// QNBS-v3: Failure injection proves a durable checkpoint resumes rather than replaying an ambiguous store.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { assertIdbMigrationTargetKeyMatchesVerifier } = vi.hoisted(() => ({
  assertIdbMigrationTargetKeyMatchesVerifier: vi.fn(),
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  assertIdbMigrationTargetKeyMatchesVerifier,
}));

import {
  __resetEncryptionMigrationJournalConnectionsForTest,
  beginEncryptionMigration,
  readEncryptionMigrationJournal,
} from '../../../services/storage/encryptionMigrationJournal';
import {
  type ProtectedStoreAdapter,
  ProtectedStoreMigrationAdapterError,
  runProtectedStoreMigration,
} from '../../../services/storage/protectedStoreMigration';

beforeEach(() => {
  __resetEncryptionMigrationJournalConnectionsForTest();
  globalThis.indexedDB = new IDBFactory();
  assertIdbMigrationTargetKeyMatchesVerifier.mockResolvedValue(undefined);
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

// QNBS-v3: Runner orchestration tests validate key presence; these adapters never invoke WebCrypto.
const migrationKeys = { sourceKey: {} as CryptoKey, targetKey: {} as CryptoKey };

describe('runProtectedStoreMigration', () => {
  it('checkpoints committed batches and reaches committing only after verification', async () => {
    const calls: Array<string | undefined> = [];
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
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

    const result = await runProtectedStoreMigration(await begin(), [adapter], migrationKeys);

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
      replaySafe: true,
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
        migrationKeys,
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
          replaySafe: true,
          async migrateNext({ cursor }) {
            resumedCalls.push(cursor);
            return { cursor: 'record-2', processed: 1, complete: true };
          },
          async verify() {
            return 2;
          },
        },
      ],
      migrationKeys,
    );

    expect(resumedCalls).toEqual(['record-1']);
    expect(resumed.phase).toBe('committing');
    expect(resumed.stores[0]).toMatchObject({ cursor: 'record-2', processed: 2, verified: 2 });
  });

  it('refuses to resume recovery-required metadata through the normal executor', async () => {
    const journal = await beginEncryptionMigration({
      operationId: 'recovery-required',
      operation: 'rekey',
      phase: 'recovery-required',
      sourceGeneration: 'source',
      targetGeneration: 'target',
      targetVerifier: [1, 2, 3],
      stores: [{ id: 'test-store', processed: 0, verified: 0, done: false }],
    });
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        throw new Error('must not execute');
      },
    };

    await expect(
      runProtectedStoreMigration(journal, [adapter], migrationKeys),
    ).rejects.toBeInstanceOf(ProtectedStoreMigrationAdapterError);
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      phase: 'recovery-required',
    });
  });

  it('rejects invalid adapter progress before it can advance the durable checkpoint', async () => {
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        return { cursor: 'record-1', processed: -1, complete: false };
      },
      async verify() {
        return 0;
      },
    };

    await expect(
      runProtectedStoreMigration(await begin(), [adapter], migrationKeys),
    ).rejects.toThrow('returned invalid progress');
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      phase: 'migrating',
      stores: [{ processed: 0, done: false }],
    });
  });

  it('rejects missing operation keys before changing the durable phase', async () => {
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        throw new Error('must not execute');
      },
    };

    await expect(
      runProtectedStoreMigration(await begin(), [adapter], { sourceKey: migrationKeys.sourceKey }),
    ).rejects.toThrow('Rekey migration requires source and target keys');
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({ phase: 'prepared' });
  });

  it('authenticates the target key before the first adapter mutation', async () => {
    assertIdbMigrationTargetKeyMatchesVerifier.mockRejectedValueOnce(new Error('wrong key'));
    const migrateNext = vi.fn(async () => ({ processed: 0, complete: true }));
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      migrateNext,
      async verify() {
        return 0;
      },
    };

    await expect(
      runProtectedStoreMigration(await begin(), [adapter], migrationKeys),
    ).rejects.toThrow('does not match the durable target verifier');
    expect(migrateNext).not.toHaveBeenCalled();
    const journal = await readEncryptionMigrationJournal();
    expect(journal).toMatchObject({ phase: 'prepared' });
    expect(journal?.ownerId).toBeUndefined();
  });

  it('does not repeat a durably verified store after verification is interrupted', async () => {
    const journal = await beginEncryptionMigration({
      operationId: 'verification-resume',
      operation: 'rekey',
      phase: 'verifying',
      sourceGeneration: 'source',
      targetGeneration: 'target',
      targetVerifier: [1, 2, 3],
      stores: [
        { id: 'first-store', processed: 2, verified: 0, done: true },
        { id: 'second-store', processed: 1, verified: 0, done: true },
      ],
    });
    const calls: string[] = [];
    const first: ProtectedStoreAdapter = {
      id: 'first-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        calls.push('first');
        return 2;
      },
    };
    const secondFailure: ProtectedStoreAdapter = {
      id: 'second-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        calls.push('second-failure');
        throw new Error('injected verification interruption');
      },
    };

    await expect(
      runProtectedStoreMigration(journal, [first, secondFailure], migrationKeys),
    ).rejects.toThrow('injected verification interruption');
    const checkpoint = await readEncryptionMigrationJournal();
    expect(checkpoint).toMatchObject({
      phase: 'verifying',
      stores: [
        { id: 'first-store', verified: 2 },
        { id: 'second-store', verified: 0 },
      ],
    });

    const secondResume: ProtectedStoreAdapter = {
      ...secondFailure,
      async verify() {
        calls.push('second-resume');
        return 1;
      },
    };
    await expect(
      runProtectedStoreMigration(checkpoint!, [first, secondResume], migrationKeys),
    ).resolves.toMatchObject({ phase: 'committing' });
    expect(calls).toEqual(['first', 'second-failure', 'second-resume']);
  });

  it('rejects a missing registered adapter before a migration can mutate storage', async () => {
    const journal = await begin();

    await expect(runProtectedStoreMigration(journal, [], {})).rejects.toThrow(
      'No registered protected-store adapter exists for test-store',
    );
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      phase: 'prepared',
      stores: [{ processed: 0, done: false }],
    });
  });

  it('rejects duplicate adapter identifiers before a migration can mutate storage', async () => {
    const adapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        throw new Error('must not execute');
      },
    };

    await expect(runProtectedStoreMigration(await begin(), [adapter, adapter], {})).rejects.toThrow(
      'Protected-store adapter ids must be unique',
    );
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({
      phase: 'prepared',
      stores: [{ processed: 0, done: false }],
    });
  });

  it('rejects a registered adapter that has no durable checkpoint before mutation', async () => {
    const checkpointAdapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('must not execute');
      },
      async verify() {
        return 0;
      },
    };
    const migrateNext = vi.fn(async () => ({ processed: 0, complete: true }));
    const adapter: ProtectedStoreAdapter = {
      id: 'store-added-after-journal-began',
      replaySafe: true,
      migrateNext,
      async verify() {
        return 0;
      },
    };

    await expect(
      runProtectedStoreMigration(await begin(), [checkpointAdapter, adapter], migrationKeys),
    ).rejects.toThrow('is missing from the migration journal');
    expect(migrateNext).not.toHaveBeenCalled();
    await expect(readEncryptionMigrationJournal()).resolves.toMatchObject({ phase: 'prepared' });
  });

  it('allows only one runner to enter adapters for the same journal revision', async () => {
    let releaseBatch: (() => void) | undefined;
    let enteredAdapter: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredAdapter = resolve;
    });
    const firstAdapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        enteredAdapter?.();
        return new Promise((resolve) => {
          releaseBatch = () => resolve({ processed: 1, complete: true, cursor: 'record-1' });
        });
      },
      async verify() {
        return 1;
      },
    };
    const secondAdapter: ProtectedStoreAdapter = {
      id: 'test-store',
      replaySafe: true,
      async migrateNext() {
        throw new Error('second runner must not enter the adapter');
      },
      async verify() {
        return 1;
      },
    };
    const journal = await begin();
    const firstRun = runProtectedStoreMigration(journal, [firstAdapter], migrationKeys);
    await entered;

    await expect(
      runProtectedStoreMigration(journal, [secondAdapter], migrationKeys),
    ).rejects.toThrow('ownership was lost');
    if (!releaseBatch) throw new Error('First migration batch did not start');
    releaseBatch();
    await expect(firstRun).resolves.toMatchObject({ phase: 'committing' });
  });
});
