/**
 * FsSnapshotStore — Snapshot CRUD, pruning, and hasSavedData.
 * QNBS-v3: Extracted from fileSystemService.ts. auto-snapshot timer is in FsCore (shared state).
 */

import type { ProjectSnapshot } from '../../types';
import { logger } from '../logger';
import { FsCodexStore } from './codexFsStore';
import {
  compressJsonText,
  countProjectWords,
  decompressJsonText,
  retryFs,
  writeTextFileAtomic,
} from './fsCore';

// Envelope stored in each snapshot file — outer shell is plain JSON, `data` field is compressed.
interface SnapshotEnvelope {
  id: number;
  name: string;
  date: string;
  wordCount: number;
  data: string; // compressData(projectData)
}

// QNBS-v3 (#553 R3): snapshot ids are millisecond timestamps; two snapshots in the same millisecond (e.g. two legacy migrations) must not share a file, since the later write would replace the earlier preserved text.
let lastSnapshotId = 0;

export class FsSnapshotStore extends FsCodexStore {
  async saveSnapshot(snapshotLabel: string, data: unknown): Promise<number> {
    return this.saveSnapshotText(snapshotLabel, JSON.stringify(data));
  }

  // QNBS-v3 (#553 §2.8): stores the canonical project text exactly — same envelope format (compressData is compressJsonText of the JSON), so existing readers are unaffected.
  async saveSnapshotText(snapshotLabel: string, projectJson: string): Promise<number> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const snapshotsPath = await apis.join(appDataPath, 'snapshots');

    if (!(await apis.exists(snapshotsPath))) {
      await apis.mkdir(snapshotsPath, { recursive: true });
    }

    let id = Math.max(Date.now(), lastSnapshotId + 1);
    // QNBS-v3 (#553 R3): another window may have used the same id; never replace an existing snapshot.
    while (await apis.exists(await apis.join(snapshotsPath, `${id}.json`))) id++;
    lastSnapshotId = id;
    const envelope: SnapshotEnvelope = {
      id,
      name: snapshotLabel,
      date: new Date().toISOString(),
      wordCount: countProjectWords(JSON.parse(projectJson)),
      data: compressJsonText(projectJson),
    };
    const snapshotFile = await apis.join(snapshotsPath, `${id}.json`);
    await writeTextFileAtomic(apis, snapshotFile, JSON.stringify(envelope));
    return id;
  }

  protected async getSnapshotJsonText(snapshotId: number): Promise<string | null> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

    if (!(await apis.exists(snapshotFile))) {
      return null;
    }

    const content = await retryFs(() => apis.readTextFile(snapshotFile));
    let envelope: unknown;
    try {
      envelope = JSON.parse(content);
    } catch {
      // QNBS-v3: preserve malformed raw snapshot text so canonical admission can classify it without a lossy parse/re-serialize step.
      return content;
    }
    if (
      typeof envelope === 'object' &&
      envelope !== null &&
      typeof (envelope as { data?: unknown }).data === 'string'
    ) {
      return decompressJsonText((envelope as { data: string }).data);
    }
    return content;
  }

  // QNBS-v3 (#553 a11): the stored text itself, unparsed, so backup egress keeps exact tokens; read failures propagate so the caller can tell them from an absent snapshot.
  async getSnapshotText(snapshotId: number): Promise<string | null> {
    return this.getSnapshotJsonText(snapshotId);
  }

  async getSnapshotData(snapshotId: number): Promise<unknown> {
    try {
      const raw = await this.getSnapshotJsonText(snapshotId);
      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      logger.error('Failed to load snapshot:', error);
      return null;
    }
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotsPath = await apis.join(appDataPath, 'snapshots');

      if (!(await apis.exists(snapshotsPath))) {
        return [];
      }

      const entries = await retryFs(() => apis.readDir(snapshotsPath));
      const jsonFiles = entries.filter((e) => e.name?.endsWith('.json'));

      const snapshots = await Promise.all(
        jsonFiles.map(async (entry) => {
          try {
            const filePath = await apis.join(snapshotsPath, entry.name!);
            const content = await retryFs(() => apis.readTextFile(filePath));
            const envelope = JSON.parse(content) as Partial<SnapshotEnvelope>;
            const numericId = parseInt(entry.name!.replace('.json', ''), 10);
            return {
              id: Number.isFinite(numericId) ? numericId : 0,
              name: envelope.name ?? entry.name!.replace('.json', ''),
              date: envelope.date ?? '',
              wordCount: envelope.wordCount ?? 0,
            } as ProjectSnapshot;
          } catch {
            return null;
          }
        }),
      );

      return (snapshots.filter(Boolean) as ProjectSnapshot[]).sort((a, b) => b.id - a.id);
    } catch (error) {
      logger.error('Failed to list snapshots:', error);
      return [];
    }
  }

  async deleteSnapshot(snapshotId: number): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

      if (await apis.exists(snapshotFile)) {
        await retryFs(() => apis.remove(snapshotFile));
      }
    } catch (error) {
      logger.error('Failed to delete snapshot:', error);
    }
  }

  async hasSavedData(): Promise<boolean> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectsPath = await apis.join(appDataPath, 'projects');
      if (!(await apis.exists(projectsPath))) return false;
      const entries = await retryFs(() => apis.readDir(projectsPath));
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  protected async pruneAutoSnapshots(): Promise<void> {
    try {
      const snapshots = await this.listSnapshots();
      if (snapshots.length <= this.MAX_AUTO_SNAPSHOTS) return;
      const sorted = [...snapshots].sort((a, b) => a.id - b.id);
      const toDelete = sorted.slice(0, snapshots.length - this.MAX_AUTO_SNAPSHOTS);
      await Promise.all(toDelete.map((s) => this.deleteSnapshot(s.id)));
    } catch (error) {
      logger.warn('Failed to prune auto snapshots:', error);
    }
  }
}
