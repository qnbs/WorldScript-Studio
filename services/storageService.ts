import type { ProjectSnapshot, Settings, StoryCodex, StoryProject } from '../types';
import type {
  BinderAssetMeta,
  BinderAssetPayload,
  CanonicalProjectRawResult,
  ImageDeleteAdmission,
  ImageWriteAdmission,
  ProjectQuarantineResult,
  RestoredSnapshot,
  SaveProjectInput,
  SaveProjectOptions,
  SnapshotRestoreTarget,
  StorageBackend,
} from './storageBackend';

export type {
  BinderAssetMeta,
  BinderAssetPayload,
  ImageDeleteAdmission,
  ImageWriteAdmission,
  ProjectQuarantineResult,
  SaveProjectEnvelope,
  SaveProjectInput,
  SnapshotRestoreTarget,
  StorageBackend,
} from './storageBackend';
export {
  makeBinderAssetIdsPrefix,
  makeBinderAssetStorageKey,
  normalizeSaveProjectInputToStoryProject,
  saveEnvelopeFromProjectData,
} from './storageBackend';

// Import existing services
import { dbService } from './dbService';
import { fileSystemService } from './fileSystemService';
import { StaleProjectWriterError } from './fs/fsCore';
import { ProjectLoadError } from './fs/projectFsStore';
import { logger } from './logger';
import { admitStructuredSnapshotRestore } from './snapshotRestoreAdmission';
import {
  assertProjectNamespaceWriteAdmitted,
  assertProjectPersistenceAdmitted,
} from './startupSafeSession';
import { normalizeSaveProjectInputToStoryProject as flatProjectOf } from './storageBackend';
import { isTauriRuntime } from './tauriRuntime';

// QNBS-v3: re-exporting the narrow storage contracts keeps callers on one backend-independent type boundary.

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

// Storage manager that chooses the appropriate backend.
// The manager adapts snapshot/project signature differences at the call-site.

function canonicalRawOrThrow(result: CanonicalProjectRawResult, projectId: string): string | null {
  switch (result.status) {
    case 'CURRENT':
      return result.raw;
    case 'ABSENT':
      return null;
    case 'STALE':
      throw new StaleProjectWriterError(projectId);
    case 'UNSUPPORTED':
      throw new Error(
        'The active storage backend cannot provide the stored project text needed for a lossless export.',
      );
    case 'REFUSED':
      throw new ProjectLoadError(
        result.classification === 'MALFORMED' ? 'corrupt' : 'unsupported-version',
        `The saved project "${projectId}" was refused as ${result.classification} and cannot be exported. It has not been changed.`,
        projectId,
      );
  }
}
export type ProjectAuthority = 'fs' | 'idb';

class StorageManager {
  private backend: StorageBackend;
  private ready: Promise<void>;

  constructor() {
    this.backend = dbService;
    this.ready = this.initializeBackend();
  }

  private async initializeBackend(): Promise<void> {
    // QNBS-v3 (T0): use the canonical isTauriRuntime() (now `__TAURI_INTERNALS__`-aware) instead of
    // a raw `window.__TAURI__` check, which was false in the real shell and forced IndexedDB.
    if (isTauriRuntime()) {
      try {
        await fileSystemService.initialize();
        await fileSystemService.removeLegacyApiKeyFiles();
        this.backend = fileSystemService;
        logger.debug('Using file system storage backend');
      } catch (error) {
        logger.warn('Failed to initialize file system storage, falling back to IndexedDB:', error);
        this.backend = dbService;
      }
    } else {
      logger.debug('Using IndexedDB storage backend');
      this.backend = dbService;
    }
  }

  private async getBackend(): Promise<StorageBackend> {
    await this.ready;
    return this.backend;
  }

  // QNBS-v3 (#553 a10): the replacement baseline is bound to the storage that really holds the project — a desktop build whose filesystem init failed runs on IndexedDB and must not share the 'fs' baseline.
  async getProjectAuthority(): Promise<ProjectAuthority> {
    const backend = await this.getBackend();
    return backend === fileSystemService ? 'fs' : 'idb';
  }

  // Delegate all methods to the current backend
  async saveProject(project: SaveProjectInput, options?: SaveProjectOptions): Promise<void> {
    // QNBS-v3: StoryProject has no typed id, but persisted envelopes carry one -- a non-string id counts as unset, which a safe session refuses.
    const projectId = (flatProjectOf(project) as unknown as Record<string, unknown>)['id'];
    assertProjectPersistenceAdmitted(typeof projectId === 'string' ? projectId : undefined);
    const backend = await this.getBackend();
    return backend.saveProject(project, options);
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    const backend = await this.getBackend();
    return backend.loadProject(projectId);
  }

  // QNBS-v3: bootstrap asks for an editable admission explicitly; backends without a distinct boundary retain their existing single-project behavior.
  async loadProjectForEditing(projectId: string): Promise<StoryProject | null> {
    const backend = await this.getBackend();
    if (backend.loadProjectForEditing) return backend.loadProjectForEditing(projectId);
    return backend.loadProject(projectId);
  }

  // QNBS-v3 (#553 §2.8): null means nothing is stored yet; every other non-CURRENT outcome throws so egress never falls back to a lossy copy.
  async loadCanonicalProjectRaw(projectId: string): Promise<string | null> {
    const backend = await this.getBackend();
    return canonicalRawOrThrow(await backend.loadCanonicalProjectRaw(projectId), projectId);
  }

  async loadEditorExportCarrier(projectId: string | undefined): Promise<string | null> {
    const backend = await this.getBackend();
    return canonicalRawOrThrow(await backend.loadEditorExportCarrier(projectId), projectId ?? '');
  }

  async listProjects(): Promise<string[]> {
    const backend = await this.getBackend();
    return backend.listProjects();
  }

  // QNBS-v3 (#332): optional on StorageBackend — IndexedDB has no multi-project ambiguity to resolve, so a missing implementation normalizes to null rather than throwing.
  async getActiveProjectId(): Promise<string | null> {
    const backend = await this.getBackend();
    return (await backend.getActiveProjectId?.()) ?? null;
  }

  // QNBS-v3: delegate supported desktop quarantine and normalize unsupported backends to null.
  async quarantineProject(projectId: string): Promise<ProjectQuarantineResult | null> {
    const backend = await this.getBackend();
    return (await backend.quarantineProject?.(projectId)) ?? null;
  }

  async deleteProject(projectId: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.deleteProject(projectId);
  }

  // QNBS-v3: projectId is trailing/optional, mirroring StorageBackend, so callers that predate project-qualification still compile unchanged and defer to each backend's own 'default' fallback.
  async saveImage(
    id: string,
    base64Data: string,
    projectId?: string,
    writeAdmission?: ImageWriteAdmission,
  ): Promise<void> {
    // QNBS-v3: an unset projectId resolves to the backend's 'default' namespace, which is exactly where a refused project may live.
    assertProjectNamespaceWriteAdmitted(projectId ?? 'default');
    const backend = await this.getBackend();
    // QNBS-v3: preserve the legacy call shape while forwarding write authority at the persistence boundary.
    return writeAdmission
      ? backend.saveImage(id, base64Data, projectId, writeAdmission)
      : backend.saveImage(id, base64Data, projectId);
  }

  async getImage(id: string, projectId?: string): Promise<string | null> {
    const backend = await this.getBackend();
    return backend.getImage(id, projectId);
  }

  // QNBS-v3: qualified-only pass-through for rollback/transaction callers -- see StorageBackend's own comment for why this must stay distinct from getImage/deleteImage.
  async getQualifiedImage(id: string, projectId?: string): Promise<string | null> {
    const backend = await this.getBackend();
    return backend.getQualifiedImage(id, projectId);
  }

  async deleteQualifiedImage(id: string, projectId?: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId ?? 'default');
    const backend = await this.getBackend();
    return backend.deleteQualifiedImage(id, projectId);
  }

  async saveSettings(settings: Settings): Promise<void> {
    const backend = await this.getBackend();
    return backend.saveSettings(settings);
  }

  async loadSettings(): Promise<Settings | null> {
    const backend = await this.getBackend();
    return backend.loadSettings();
  }

  async saveGeminiApiKey(apiKey: string): Promise<void> {
    // QNBS-v3: API keys stay in the random-key IndexedDB store; filesystem-derived material is not a secret.
    return dbService.saveGeminiApiKey(apiKey);
  }

  async getGeminiApiKey(): Promise<string | null> {
    return dbService.getGeminiApiKey();
  }

  async clearGeminiApiKey(): Promise<void> {
    return dbService.clearGeminiApiKey();
  }

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    return dbService.saveApiKey(provider, apiKey);
  }

  async getApiKey(provider: string): Promise<string | null> {
    return dbService.getApiKey(provider);
  }

  async clearApiKey(provider: string): Promise<void> {
    return dbService.clearApiKey(provider);
  }

  async saveSnapshot(name: string, data: unknown): Promise<number> {
    const backend = await this.getBackend();
    return backend.saveSnapshot(name, data);
  }

  // QNBS-v3 (#553 §2.8): a snapshot of the canonical project text, not a re-serialized parse.
  async saveSnapshotText(name: string, projectJson: string): Promise<number> {
    const backend = await this.getBackend();
    return backend.saveSnapshotText(name, projectJson);
  }

  async getSnapshotData(id: number): Promise<unknown> {
    const backend = await this.getBackend();
    return backend.getSnapshotData(id);
  }

  // QNBS-v3 (#553 a11): the backend's authoritative snapshot carrier — stored text where the backend keeps text, otherwise the stored structured value serialized (no lexical guarantee beyond that value).
  async getSnapshotText(id: number): Promise<string | null> {
    const backend = await this.getBackend();
    if (backend.getSnapshotText) return backend.getSnapshotText(id);
    const data = await backend.getSnapshotData(id);
    return data === null || data === undefined ? null : JSON.stringify(data);
  }

  // QNBS-v3: filesystem backends receive the pre-read target; a backend without its own restore authority (IndexedDB) gets the same canonical admission and owner check here, never an unchecked stored object (#553 §2.8).
  async restoreSnapshot(
    id: number,
    currentProject: SnapshotRestoreTarget,
  ): Promise<RestoredSnapshot> {
    const backend = await this.getBackend();
    if (backend.restoreSnapshot) {
      return backend.restoreSnapshot(id, currentProject);
    }
    // QNBS-v3 (#553 a5): IndexedDB holds a structured snapshot, so its admitted CURRENT object serialized is the whole carrier.
    const project = admitStructuredSnapshotRestore(
      await backend.getSnapshotData(id),
      currentProject,
    );
    return { project, raw: JSON.stringify(project) };
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    const backend = await this.getBackend();
    return backend.listSnapshots();
  }

  async deleteSnapshot(id: number): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteSnapshot(id);
  }

  // QNBS-v3: same trailing-optional projectId compatibility shape as saveImage/getImage above.
  async deleteImage(
    id: string,
    projectId?: string,
    deleteAdmission?: ImageDeleteAdmission,
  ): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId ?? 'default');
    const backend = await this.getBackend();
    return deleteAdmission
      ? backend.deleteImage(id, projectId, deleteAdmission)
      : backend.deleteImage(id, projectId);
  }

  async hasSavedData(): Promise<boolean> {
    const backend = await this.getBackend();
    return backend.hasSavedData();
  }

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    assertProjectNamespaceWriteAdmitted(codex.projectId);
    const backend = await this.getBackend();
    return backend.saveStoryCodex(codex);
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    const backend = await this.getBackend();
    return backend.getStoryCodex(projectId);
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.deleteStoryCodex(projectId);
  }

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.saveRagVectors(projectId, vectors);
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    const backend = await this.getBackend();
    return backend.getRagVectors(projectId);
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.deleteRagVectors(projectId);
  }

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.saveBinderAsset(projectId, assetId, data, meta);
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    const backend = await this.getBackend();
    return backend.getBinderAsset(projectId, assetId);
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.deleteBinderAsset(projectId, assetId);
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    const backend = await this.getBackend();
    return backend.listBinderAssetIds(projectId);
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    assertProjectNamespaceWriteAdmitted(projectId);
    const backend = await this.getBackend();
    return backend.deleteAllBinderAssetsForProject(projectId);
  }

  // QNBS-v3: Explizites Backend-Label für Settings-Diagnostik — keine Heuristik über window allein.
  async getStorageBackendKind(): Promise<'indexeddb' | 'filesystem'> {
    await this.ready;
    return this.backend === fileSystemService ? 'filesystem' : 'indexeddb';
  }
}

export const storageService = new StorageManager();
