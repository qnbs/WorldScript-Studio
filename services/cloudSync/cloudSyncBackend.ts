// QNBS-v3: Cloud-Sync StorageBackend stub — implements the contract, delegates projects/settings
// to the R2 client. Sensitive keys (API keys) are NEVER sent to cloud; delegation throws.
// Future feature (v2.0): not wired into storageService. The enableCloudSync flag was retired in
// v1.20 housekeeping (no UI ever shipped); create() keeps an explicit-consent boolean guard instead.

import type { ProjectSnapshot, Settings, StoryCodex, StoryProject } from '../../types';
import type {
  BinderAssetMeta,
  BinderAssetPayload,
  SaveProjectInput,
  StorageBackend,
} from '../storageBackend';
import { normalizeSaveProjectInputToStoryProject } from '../storageBackend';
import type { CloudSyncConfig } from './cloudSyncClient';
import { CloudSyncClient } from './cloudSyncClient';
import { decryptCloudPayload, encryptCloudPayload } from './cloudSyncEncryption';

const KEY_SETTINGS = 'settings';
const KEY_PREFIX_PROJECT = 'project/';
const KEY_PREFIX_CODEX = 'codex/';
const KEY_PREFIX_RAG = 'rag/';

// QNBS-v3: P2-1 — Conflict resolution metadata for Last-Write-Wins
interface CloudSyncMetadata {
  lastModified: number;
  deviceId: string;
  version: number;
}

interface CloudSyncPayload<T> {
  data: T;
  meta: CloudSyncMetadata;
}

export class CloudSyncBackend implements StorageBackend {
  private readonly client: CloudSyncClient;
  private readonly encryptionKey: CryptoKey;

  /** Use `CloudSyncBackend.create()` — constructor is sync, key derivation is async. */
  constructor(client: CloudSyncClient, encryptionKey: CryptoKey) {
    this.client = client;
    this.encryptionKey = encryptionKey;
  }

  static async create(
    config: CloudSyncConfig,
    passphrase: string,
    userId: string,
    /** Explicit-consent gate — caller must pass true to confirm the user opted into cloud sync. */
    explicitConsent = false,
  ): Promise<CloudSyncBackend> {
    // QNBS-v3: Structural consent guard — Cloud Sync must never activate without explicit opt-in.
    // The enableCloudSync flag was retired in v1.20 (no UI shipped); this boolean replaces it.
    if (!explicitConsent) {
      throw new Error(
        'CloudSyncBackend.create(): explicit user consent required. Cloud Sync is not yet user-facing (v2.0 feature).',
      );
    }
    const { deriveCloudSyncKey } = await import('./cloudSyncEncryption');
    const key = await deriveCloudSyncKey(passphrase, userId);
    return new CloudSyncBackend(new CloudSyncClient(config), key);
  }

  private async enc<T>(data: T): Promise<string> {
    return encryptCloudPayload(this.encryptionKey, data);
  }

  private async dec<T>(blob: string): Promise<T> {
    return decryptCloudPayload<T>(this.encryptionKey, blob);
  }

  // QNBS-v3: P2-1 — Last-Write-Wins conflict resolution helpers
  private getDeviceId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private async saveWithMetadata<T>(key: string, data: T): Promise<void> {
    const payload: CloudSyncPayload<T> = {
      data,
      meta: {
        lastModified: Date.now(),
        deviceId: this.getDeviceId(),
        version: 1,
      },
    };
    const blob = await this.enc(payload);
    await this.client.put(key, blob);
  }

  private async loadWithMetadata<T>(key: string): Promise<T | null> {
    const blob = await this.client.get(key);
    if (!blob) return null;
    const payload = await this.dec<CloudSyncPayload<T>>(blob);
    return payload.data;
  }

  async saveProject(project: SaveProjectInput): Promise<void> {
    const flat = normalizeSaveProjectInputToStoryProject(project);
    // QNBS-v3: StoryProject has no id; extract it from the SaveProjectEnvelope before flattening.
    const env = project as { present?: { data?: { id?: string } }; data?: { id?: string } };
    const projectId = env?.present?.data?.id ?? env?.data?.id ?? 'default';
    // QNBS-v3: P2-1 — Use conflict-aware save with metadata
    await this.saveWithMetadata(`${KEY_PREFIX_PROJECT}${projectId}`, flat);
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    // QNBS-v3: P2-1 — Use conflict-aware load with metadata
    return this.loadWithMetadata<StoryProject>(`${KEY_PREFIX_PROJECT}${projectId}`);
  }

  async listProjects(): Promise<string[]> {
    const items = await this.client.list(KEY_PREFIX_PROJECT);
    return items.map((m) => m.key.replace(KEY_PREFIX_PROJECT, ''));
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`${KEY_PREFIX_PROJECT}${projectId}`);
  }

  async saveSettings(settings: Settings): Promise<void> {
    // QNBS-v3: P2-1 — Use conflict-aware save with metadata
    await this.saveWithMetadata(KEY_SETTINGS, settings);
  }

  async loadSettings(): Promise<Settings | null> {
    // QNBS-v3: P2-1 — Use conflict-aware load with metadata
    return this.loadWithMetadata<Settings>(KEY_SETTINGS);
  }

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    // QNBS-v3: P2-1 — Use conflict-aware save with metadata
    await this.saveWithMetadata(`${KEY_PREFIX_CODEX}${codex.projectId}`, codex);
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    // QNBS-v3: P2-1 — Use conflict-aware load with metadata
    return this.loadWithMetadata<StoryCodex>(`${KEY_PREFIX_CODEX}${projectId}`);
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    await this.client.delete(`${KEY_PREFIX_CODEX}${projectId}`);
  }

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    // QNBS-v3: P2-1 — Use conflict-aware save with metadata
    await this.saveWithMetadata(`${KEY_PREFIX_RAG}${projectId}`, vectors);
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    // QNBS-v3: P2-1 — Use conflict-aware load with metadata
    const result = await this.loadWithMetadata<unknown[]>(`${KEY_PREFIX_RAG}${projectId}`);
    return result ?? [];
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    await this.client.delete(`${KEY_PREFIX_RAG}${projectId}`);
  }

  async hasSavedData(): Promise<boolean> {
    const items = await this.client.list(KEY_PREFIX_PROJECT);
    return items.length > 0;
  }

  // --- Not synced to cloud (security / size constraints) ---

  async saveImage(_id: string, _base64Data: string): Promise<void> {
    // QNBS-v3: Images are not synced — large binary blobs belong in local IDB.
    throw new Error('CloudSyncBackend: image storage is local-only');
  }

  async getImage(_id: string): Promise<string | null> {
    throw new Error('CloudSyncBackend: image storage is local-only');
  }

  async deleteImage(_id: string): Promise<void> {
    throw new Error('CloudSyncBackend: image storage is local-only');
  }

  async saveGeminiApiKey(_apiKey: string): Promise<void> {
    // QNBS-v3: API keys MUST stay local — never upload credentials to cloud.
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async getGeminiApiKey(): Promise<string | null> {
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async clearGeminiApiKey(): Promise<void> {
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async saveApiKey(_provider: string, _apiKey: string): Promise<void> {
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async getApiKey(_provider: string): Promise<string | null> {
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async clearApiKey(_provider: string): Promise<void> {
    throw new Error('CloudSyncBackend: API keys are stored locally only');
  }

  async saveSnapshot(_label: string, _data: unknown): Promise<number> {
    throw new Error('CloudSyncBackend: snapshots are local-only');
  }

  async getSnapshotData(_id: number): Promise<unknown> {
    throw new Error('CloudSyncBackend: snapshots are local-only');
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    throw new Error('CloudSyncBackend: snapshots are local-only');
  }

  async deleteSnapshot(_id: number): Promise<void> {
    throw new Error('CloudSyncBackend: snapshots are local-only');
  }

  async saveBinderAsset(
    _projectId: string,
    _assetId: string,
    _data: ArrayBuffer,
    _meta: BinderAssetMeta,
  ): Promise<void> {
    throw new Error('CloudSyncBackend: binder assets are local-only');
  }

  async getBinderAsset(_projectId: string, _assetId: string): Promise<BinderAssetPayload | null> {
    throw new Error('CloudSyncBackend: binder assets are local-only');
  }

  async deleteBinderAsset(_projectId: string, _assetId: string): Promise<void> {
    throw new Error('CloudSyncBackend: binder assets are local-only');
  }

  async listBinderAssetIds(_projectId: string): Promise<string[]> {
    throw new Error('CloudSyncBackend: binder assets are local-only');
  }

  async deleteAllBinderAssetsForProject(_projectId: string): Promise<void> {
    throw new Error('CloudSyncBackend: binder assets are local-only');
  }
}
