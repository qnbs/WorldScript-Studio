// QNBS-v3: Cloud-Sync StorageBackend stub — implements the contract, delegates projects/settings
// to the R2 client. Sensitive keys (API keys) are NEVER sent to cloud; delegation throws.
// Feature-gated behind enableCloudSync; not wired into storageService until flag is on.

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
  ): Promise<CloudSyncBackend> {
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

  async saveProject(project: SaveProjectInput): Promise<void> {
    const flat = normalizeSaveProjectInputToStoryProject(project);
    // QNBS-v3: StoryProject has no id; extract it from the SaveProjectEnvelope before flattening.
    const env = project as { present?: { data?: { id?: string } }; data?: { id?: string } };
    const projectId = env?.present?.data?.id ?? env?.data?.id ?? 'default';
    const blob = await this.enc(flat);
    await this.client.put(`${KEY_PREFIX_PROJECT}${projectId}`, blob);
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    const blob = await this.client.get(`${KEY_PREFIX_PROJECT}${projectId}`);
    if (!blob) return null;
    return this.dec<StoryProject>(blob);
  }

  async listProjects(): Promise<string[]> {
    const items = await this.client.list(KEY_PREFIX_PROJECT);
    return items.map((m) => m.key.replace(KEY_PREFIX_PROJECT, ''));
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`${KEY_PREFIX_PROJECT}${projectId}`);
  }

  async saveSettings(settings: Settings): Promise<void> {
    const blob = await this.enc(settings);
    await this.client.put(KEY_SETTINGS, blob);
  }

  async loadSettings(): Promise<Settings | null> {
    const blob = await this.client.get(KEY_SETTINGS);
    if (!blob) return null;
    return this.dec<Settings>(blob);
  }

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    const blob = await this.enc(codex);
    await this.client.put(`${KEY_PREFIX_CODEX}${codex.projectId}`, blob);
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    const blob = await this.client.get(`${KEY_PREFIX_CODEX}${projectId}`);
    if (!blob) return null;
    return this.dec<StoryCodex>(blob);
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    await this.client.delete(`${KEY_PREFIX_CODEX}${projectId}`);
  }

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    const blob = await this.enc(vectors);
    await this.client.put(`${KEY_PREFIX_RAG}${projectId}`, blob);
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    const blob = await this.client.get(`${KEY_PREFIX_RAG}${projectId}`);
    if (!blob) return [];
    return this.dec<unknown[]>(blob);
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
