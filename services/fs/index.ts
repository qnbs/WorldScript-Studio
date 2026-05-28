/**
 * services/fs/index.ts — Composite FileSystemService assembling all domain stores.
 * QNBS-v3: FileSystemService is a thin alias class; all methods live in the store chain:
 * FsCore → FsSettingsStore → FsCodexStore → FsSnapshotStore → FsAssetStore → FsProjectStore
 */

import type { StorageBackend } from '../storageBackend';
import { FsProjectStore } from './projectFsStore';

export class FileSystemService extends FsProjectStore implements StorageBackend {}

export const fileSystemService: FileSystemService = new FileSystemService();

export { FsAssetStore } from './assetFsStore';
export { FsCodexStore } from './codexFsStore';
// Re-export store classes and utilities for callers that previously imported from fileSystemService.ts
export {
  compressData,
  decompressData,
  FsCore,
  loadTauriApis,
  retryFs,
  sanitizePathSegment,
} from './fsCore';
export { FsProjectStore } from './projectFsStore';
export { FsSettingsStore } from './settingsFsStore';
export { FsSnapshotStore } from './snapshotFsStore';
