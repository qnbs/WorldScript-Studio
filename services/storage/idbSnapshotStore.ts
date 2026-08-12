/**
 * IdbSnapshotStore — Project snapshot CRUD + automatic snapshot scheduling.
 * ENCRYPTION: AES-256-GCM via StorageEncryptionService when isIdbEncryptionReady() — else plaintext.
 * QNBS-v3: Extracted from dbService.ts. lastAutoSnapshotTime is protected so IdbProjectStore can reset it.
 *          Phase 2 B-1: snapshot payload encrypted when session key is active.
 */

import type { ProjectData } from '../../features/project/projectSlice';
import type { ProjectSnapshot } from '../../types';
import { SNAPSHOTS_STORE } from '../dbConstants';
import { IdbCodexStore } from './idbCodexStore';
import { compressData, getUserFriendlyDbError, retryDb } from './idbCore';
import { withProtectedWriteAdmission } from './protectedWriteAdmission';
import {
  assertIdbProtectedWriteAllowed,
  assertNoActiveEncryptionMigration,
  assertSecureStorageReadable,
  idbEncryptWithKey,
  idbReadSecure,
  resolveProtectedWriteKey,
} from './storageEncryptionService';

export class IdbSnapshotStore extends IdbCodexStore {
  protected lastAutoSnapshotTime = Date.now();
  protected readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  protected readonly MAX_AUTO_SNAPSHOTS = 20;

  async createSnapshot(data: ProjectData, name?: string): Promise<number> {
    return withProtectedWriteAdmission(() => {
      const wordCount = data.manuscript.reduce(
        (sum, section) => sum + (section.content?.split(/\s+/).filter(Boolean).length || 0),
        0,
      );
      return retryDb(async () => {
        // QNBS-v3: Resolve the write key in one atomic snapshot rather than re-reading
        //          isIdbEncryptionReady() later, so Lock Session during this async call cannot
        //          silently downgrade an already-approved snapshot to plaintext.
        const writeKey = await resolveProtectedWriteKey();
        // QNBS-v3: Plaintext snapshots are allowed only before encryption is configured.
        const snapshotPayload = writeKey
          ? await idbEncryptWithKey(writeKey, data)
          : compressData(data);
        const snapshotData = {
          date: new Date().toISOString(),
          name: name ?? 'Automatic Snapshot',
          wordCount,
          data: snapshotPayload,
        };
        // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
        await assertNoActiveEncryptionMigration();
        const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
        return new Promise<number>((resolve, reject) => {
          const request = store.add(snapshotData);
          request.onsuccess = () => resolve(request.result as number);
          request.onerror = () => reject(getUserFriendlyDbError(request.error));
        });
      });
    });
  }

  async saveSnapshot(name: string, data: ProjectData): Promise<number> {
    return this.createSnapshot(data, name);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    return retryDb(async () => {
      // QNBS-v3: Snapshot metadata (name/date/word count) is about protected content — the superset check blocks a locked session, or an active journal migration, from enumerating it.
      await assertSecureStorageReadable();
      const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readonly');
      // IDBKeyRange: iterate in reverse (newest first) using cursor direction 'prev'
      const request = store.openCursor(null, 'prev');
      const snapshots: ProjectSnapshot[] = [];

      return new Promise<ProjectSnapshot[]>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const { data: _data, ...metadata } = cursor.value;
            snapshots.push({ id: cursor.key as number, ...metadata });
            cursor.continue();
          } else {
            resolve(snapshots);
          }
        };
        request.onerror = () => reject(getUserFriendlyDbError(request.error));
      });
    });
  }

  async getSnapshotData(id: number): Promise<ProjectData> {
    return retryDb(async () => {
      // QNBS-v3: superset check — blocks a locked session or an active journal migration before the record lookup can even run.
      await assertSecureStorageReadable();
      const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readonly');
      return new Promise<ProjectData>((resolve, reject) => {
        const request = store.get(id);
        // QNBS-v3: IDBRequest.onsuccess is not awaited by the browser — an unhandled rejection
        //          here would leave the caller pending instead of surfacing the error.
        request.onsuccess = () => {
          if (request.result === undefined) {
            reject(new Error(`Snapshot ${id} was not found`));
            return;
          }
          // QNBS-v3: Decrypt encrypted snapshot payload; legacy plaintext falls through decompressData.
          idbReadSecure<ProjectData>(request.result.data).then(resolve).catch(reject);
        };
        request.onerror = () => reject(getUserFriendlyDbError(request.error));
      });
    });
  }

  async deleteSnapshot(id: number): Promise<void> {
    return retryDb(() => withProtectedWriteAdmission(() => this.deleteSnapshotsUnadmitted([id])));
  }

  // QNBS-v3: one transaction + one admission hold for N deletes, not N round trips — used by both deleteSnapshot() and pruneAutoSnapshots().
  private async deleteSnapshotsUnadmitted(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await assertIdbProtectedWriteAllowed();
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise<void>((resolve, reject) => {
      let failure: string | undefined;
      for (const id of ids) {
        const request = store.delete(id);
        request.onerror = () => {
          failure = getUserFriendlyDbError(request.error);
          transaction.abort();
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(failure ?? getUserFriendlyDbError(transaction.error));
    });
  }

  protected async pruneAutoSnapshots(): Promise<void> {
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
    // Use IDBKeyRange to get all keys efficiently (no full data fetch needed)
    const allKeys: number[] = await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result as number[]);
      req.onerror = () => reject(req.error);
    });

    if (allKeys.length <= this.MAX_AUTO_SNAPSHOTS) return;

    // Keys are auto-increment ints → oldest first; delete oldest excess
    const toDelete = allKeys
      .sort((a, b) => a - b)
      .slice(0, allKeys.length - this.MAX_AUTO_SNAPSHOTS);

    await retryDb(() =>
      withProtectedWriteAdmission(() => this.deleteSnapshotsUnadmitted(toDelete)),
    );
  }
}
