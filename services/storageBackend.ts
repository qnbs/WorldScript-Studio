import type { ProjectData } from '../features/project/projectSlice';
import type { ProjectSnapshot, Settings, StoryCodex, StoryProject } from '../types';

/** Metadata for binder binary assets (PDF, images, audio) stored outside Redux. */
export interface BinderAssetMeta {
  mimeType: string;
  originalFileName: string;
  byteSize: number;
}

export interface BinderAssetPayload {
  data: ArrayBuffer;
  meta: BinderAssetMeta;
}

/** IndexedDB / filesystem key for binder blobs — stable delimiter avoids UUID clashes. */
export function makeBinderAssetStorageKey(projectId: string, assetId: string): string {
  const safeProject = projectId.replace(/[\s:]/g, '_').slice(0, 200);
  return `${safeProject}::${assetId}`;
}

/** Prefix for listing/deleting all binder assets of a project (`projectId::`). */
export function makeBinderAssetIdsPrefix(projectId: string): string {
  const safeProject = projectId.replace(/[\s:]/g, '_').slice(0, 200);
  return `${safeProject}::`;
}

/**
 * Redux-undo / auto-save shape (not a flat `StoryProject` export).
 * Kept separate from `StoryProject` so call-sites can type auto-save without casts.
 */
export interface SaveProjectEnvelope {
  data?: ProjectData;
  present?: { data: ProjectData };
}

/**
 * Payload from auto-save / Redux (`{ data }` envelope) or a flat exported `StoryProject`.
 */
export type SaveProjectInput = StoryProject | SaveProjectEnvelope;

/** Auto-save from the current `ProjectData` (listener middleware) — returns a properly typed envelope. */
export function saveEnvelopeFromProjectData(data: ProjectData): SaveProjectEnvelope {
  return { data };
}

/** Single normalization path for filesystem / UI: flat `StoryProject` from any save input. */
export function normalizeSaveProjectInputToStoryProject(project: SaveProjectInput): StoryProject {
  if ('present' in project && project.present?.data) {
    return project.present.data as StoryProject;
  }
  if ('data' in project && project.data) {
    return project.data as StoryProject;
  }
  return project as StoryProject;
}

/**
 * Contract implemented by IndexedDB (`dbService`) and Tauri filesystem (`fileSystemService`).
 * Single source of truth — import from here, not from `storageService`, to avoid circular deps.
 */
export interface StorageBackend {
  saveProject(project: SaveProjectInput): Promise<void>;
  loadProject(projectId: string): Promise<StoryProject | null>;
  listProjects(): Promise<string[]>;
  deleteProject(projectId: string): Promise<void>;

  saveImage(id: string, base64Data: string): Promise<void>;
  getImage(id: string): Promise<string | null>;

  saveSettings(settings: Settings): Promise<void>;
  loadSettings(): Promise<Settings | null>;

  saveGeminiApiKey(apiKey: string): Promise<void>;
  getGeminiApiKey(): Promise<string | null>;
  clearGeminiApiKey(): Promise<void>;

  saveApiKey(provider: string, apiKey: string): Promise<void>;
  getApiKey(provider: string): Promise<string | null>;
  clearApiKey(provider: string): Promise<void>;

  /** Snapshot IDs: numeric (Date.now / IDB auto-increment). */
  saveSnapshot(snapshotLabel: string, data: unknown): Promise<number>;
  getSnapshotData(snapshotId: number): Promise<unknown>;
  listSnapshots(): Promise<ProjectSnapshot[]>;
  deleteSnapshot(snapshotId: number): Promise<void>;

  deleteImage(id: string): Promise<void>;

  hasSavedData(): Promise<boolean>;

  saveStoryCodex(codex: StoryCodex): Promise<void>;
  getStoryCodex(projectId: string): Promise<StoryCodex | null>;
  deleteStoryCodex(projectId: string): Promise<void>;

  saveRagVectors(projectId: string, vectors: unknown[]): Promise<void>;
  getRagVectors(projectId: string): Promise<unknown[]>;
  deleteRagVectors(projectId: string): Promise<void>;

  /** Large binder files (research PDFs, images); Redux keeps only asset IDs. */
  saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void>;
  getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null>;
  deleteBinderAsset(projectId: string, assetId: string): Promise<void>;
  listBinderAssetIds(projectId: string): Promise<string[]>;
  deleteAllBinderAssetsForProject(projectId: string): Promise<void>;
}
