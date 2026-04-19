import type { ProjectSnapshot, Settings, StoryCodex, StoryProject } from '../types';

// Storage interface for different backends
export interface StorageBackend {
  // Project operations
  saveProject(project: StoryProject): Promise<void>;
  loadProject(projectId: string): Promise<StoryProject | null>;
  listProjects(): Promise<string[]>;
  deleteProject(projectId: string): Promise<void>;

  // Image operations
  saveImage(id: string, base64Data: string): Promise<void>;
  getImage(id: string): Promise<string | null>;

  // Settings operations
  saveSettings(settings: Settings): Promise<void>;
  loadSettings(): Promise<Settings | null>;

  // Gemini API key
  saveGeminiApiKey(apiKey: string): Promise<void>;
  getGeminiApiKey(): Promise<string | null>;
  clearGeminiApiKey(): Promise<void>;

  // Generic provider API key (openai, anthropic, etc.)
  saveApiKey(provider: string, apiKey: string): Promise<void>;
  getApiKey(provider: string): Promise<string | null>;
  clearApiKey(provider: string): Promise<void>;

  // Snapshots — IDs are numeric (Date.now() in FS backend, autoIncrement in IndexedDB)
  saveSnapshot(snapshotLabel: string, data: unknown): Promise<number>;
  getSnapshotData(snapshotId: number): Promise<unknown>;
  listSnapshots(): Promise<ProjectSnapshot[]>;
  deleteSnapshot(snapshotId: number): Promise<void>;

  // Image deletion
  deleteImage(id: string): Promise<void>;

  // First-launch detection
  hasSavedData(): Promise<boolean>;

  // Story Codex (extracted entity index per project)
  saveStoryCodex(codex: StoryCodex): Promise<void>;
  getStoryCodex(projectId: string): Promise<StoryCodex | null>;
  deleteStoryCodex(projectId: string): Promise<void>;

  // RAG vectors (embedding store per project — file-per-project, compressed)
  saveRagVectors(projectId: string, vectors: unknown[]): Promise<void>;
  getRagVectors(projectId: string): Promise<unknown[]>;
  deleteRagVectors(projectId: string): Promise<void>;
}

// Import existing services
import { dbService } from './dbService';
import { fileSystemService } from './fileSystemService';
import { logger } from './logger';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

// Storage manager that chooses the appropriate backend.
// The manager adapts snapshot/project signature differences at the call-site.
class StorageManager {
  private backend: StorageBackend;
  private ready: Promise<void>;

  constructor() {
    this.backend = dbService as unknown as StorageBackend;
    this.ready = this.initializeBackend();
  }

  private async initializeBackend(): Promise<void> {
    // Check if we're running in Tauri
    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        await fileSystemService.initialize();
        this.backend = fileSystemService as unknown as StorageBackend;
        logger.debug('Using file system storage backend');
      } catch (error) {
        logger.warn('Failed to initialize file system storage, falling back to IndexedDB:', error);
        this.backend = dbService as unknown as StorageBackend;
      }
    } else {
      logger.debug('Using IndexedDB storage backend');
      this.backend = dbService as unknown as StorageBackend;
    }
  }

  private async getBackend(): Promise<StorageBackend> {
    await this.ready;
    return this.backend;
  }

  // Delegate all methods to the current backend
  async saveProject(project: unknown): Promise<void> {
    const backend = await this.getBackend();
    return (backend.saveProject as (p: unknown) => Promise<void>)(project);
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    const backend = await this.getBackend();
    return backend.loadProject(projectId);
  }

  async listProjects(): Promise<string[]> {
    const backend = await this.getBackend();
    return backend.listProjects();
  }

  async deleteProject(projectId: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteProject(projectId);
  }

  async saveImage(id: string, base64Data: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.saveImage(id, base64Data);
  }

  async getImage(id: string): Promise<string | null> {
    const backend = await this.getBackend();
    return backend.getImage(id);
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
    const backend = await this.getBackend();
    return backend.saveGeminiApiKey(apiKey);
  }

  async getGeminiApiKey(): Promise<string | null> {
    const backend = await this.getBackend();
    return backend.getGeminiApiKey();
  }

  async clearGeminiApiKey(): Promise<void> {
    const backend = await this.getBackend();
    return backend.clearGeminiApiKey();
  }

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.saveApiKey(provider, apiKey);
  }

  async getApiKey(provider: string): Promise<string | null> {
    const backend = await this.getBackend();
    return backend.getApiKey(provider);
  }

  async clearApiKey(provider: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.clearApiKey(provider);
  }

  async saveSnapshot(name: string, data: unknown): Promise<number> {
    const backend = await this.getBackend();
    return backend.saveSnapshot(name, data);
  }

  async getSnapshotData(id: number): Promise<unknown> {
    const backend = await this.getBackend();
    return backend.getSnapshotData(id);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    const backend = await this.getBackend();
    return backend.listSnapshots();
  }

  async deleteSnapshot(id: number): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteSnapshot(id);
  }

  async deleteImage(id: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteImage(id);
  }

  async hasSavedData(): Promise<boolean> {
    const backend = await this.getBackend();
    return backend.hasSavedData();
  }

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    const backend = await this.getBackend();
    return backend.saveStoryCodex(codex);
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    const backend = await this.getBackend();
    return backend.getStoryCodex(projectId);
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteStoryCodex(projectId);
  }

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    const backend = await this.getBackend();
    return backend.saveRagVectors(projectId, vectors);
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    const backend = await this.getBackend();
    return backend.getRagVectors(projectId);
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    const backend = await this.getBackend();
    return backend.deleteRagVectors(projectId);
  }
}

export const storageService = new StorageManager();
