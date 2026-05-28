/**
 * IdbSnapshotStore — Project snapshot CRUD + automatic snapshot scheduling.
 * ENCRYPTION: plaintext — snapshot data inherits the project's compression; at-rest encryption Phase 2.
 * QNBS-v3: Extracted from dbService.ts. lastAutoSnapshotTime is protected so IdbProjectStore can reset it.
 */

import type { ProjectData } from '../../features/project/projectSlice';
import type { ProjectSnapshot } from '../../types';
import { SNAPSHOTS_STORE } from '../dbConstants';
import { IdbCodexStore } from './idbCodexStore';
import { compressData, decompressData, getUserFriendlyDbError, retryDb } from './idbCore';

export class IdbSnapshotStore extends IdbCodexStore {
  protected lastAutoSnapshotTime = Date.now();
  protected readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  protected readonly MAX_AUTO_SNAPSHOTS = 20;

  async createSnapshot(data: ProjectData, name?: string): Promise<number> {
    const wordCount = data.manuscript.reduce(
      (sum, section) => sum + (section.content?.split(/\s+/).filter(Boolean).length || 0),
      0,
    );
    const snapshotData = {
      date: new Date().toISOString(),
      name: name || 'Automatic Snapshot',
      wordCount,
      // Compress snapshot payload – snapshots can be very large
      data: compressData(data),
    };

    return retryDb(async () => {
      const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
      return new Promise<number>((resolve, reject) => {
        const request = store.add(snapshotData);
        request.onsuccess = () => resolve(request.result as number);
        request.onerror = () => reject(getUserFriendlyDbError(request.error));
      });
    });
  }

  async saveSnapshot(name: string, data: ProjectData): Promise<number> {
    return this.createSnapshot(data, name);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    return retryDb(async () => {
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
      const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readonly');
      return new Promise<ProjectData>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const raw = request.result?.data;
          resolve(decompressData<ProjectData>(raw));
        };
        request.onerror = () => reject(getUserFriendlyDbError(request.error));
      });
    });
  }

  async deleteSnapshot(id: number): Promise<void> {
    return retryDb(async () => {
      const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(getUserFriendlyDbError(request.error));
      });
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

    for (const key of toDelete) {
      await this.deleteSnapshot(key);
    }
  }
}
