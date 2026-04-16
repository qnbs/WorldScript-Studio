import type { StoryProject, Settings, ProjectSnapshot } from '../types';
import type { ProjectData } from '../features/project/projectSlice';

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

  // Snapshots
  saveSnapshot(snapshotId: string, data: unknown): Promise<void>;
  getSnapshotData(snapshotId: string): Promise<unknown>;
  listSnapshots(): Promise<string[]>;
  deleteSnapshot(snapshotId: string): Promise<void>;
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

// Storage manager that chooses the appropriate backend
// dbService does not implement StorageBackend exactly (different snapshot/project
// signatures) but is compatible at runtime. The manager adapts where needed.
class StorageManager {
  private backend: StorageBackend | typeof dbService;
  private ready: Promise<void>;

  constructor() {
    this.backend = dbService;
    this.ready = this.initializeBackend();
  }

  private async initializeBackend(): Promise<void> {
    // Check if we're running in Tauri
    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        await fileSystemService.initialize();
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

  private async getBackend(): Promise<StorageBackend | typeof dbService> {
    await this.ready;
    return this.backend;
  }

  // Delegate all methods to the current backend
  async saveProject(project: unknown): Promise<void> {
    const backend = await this.getBackend();
    return (backend.saveProject as (p: unknown) => Promise<void>)(project);
  }

  async loadProject(_projectId: string): Promise<StoryProject | null> {
    const backend = await this.getBackend();
    if ('loadProject' in backend) {
      return (backend as StorageBackend).loadProject(_projectId);
    }
    return null;
  }

  async listProjects(): Promise<string[]> {
    const backend = await this.getBackend();
    if ('listProjects' in backend) {
      return (backend as StorageBackend).listProjects();
    }
    return [];
  }

  async deleteProject(_projectId: string): Promise<void> {
    const backend = await this.getBackend();
    if ('deleteProject' in backend) {
      return (backend as StorageBackend).deleteProject(_projectId);
    }
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
    if (
      'loadSettings' in backend &&
      typeof (backend as StorageBackend).loadSettings === 'function'
    ) {
      return (backend as StorageBackend).loadSettings();
    }
    return null;
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

  async saveSnapshot(name: string, data: unknown): Promise<void> {
    const backend = await this.getBackend();
    if ('saveSnapshot' in backend) {
      return (backend as StorageBackend).saveSnapshot(name, data);
    }
    // IndexedDB backend uses createSnapshot(data, name)
    return (backend as typeof dbService).createSnapshot(data as ProjectData, name);
  }

  async getSnapshotData(id: number): Promise<unknown> {
    const backend = await this.getBackend();
    return (backend.getSnapshotData as (i: number) => Promise<unknown>)(id);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    const backend = await this.getBackend();
    const result = await backend.listSnapshots();
    return result as ProjectSnapshot[];
  }

  async deleteSnapshot(id: number): Promise<void> {
    const backend = await this.getBackend();
    return (backend.deleteSnapshot as (i: number) => Promise<void>)(id);
  }
}

export const storageService = new StorageManager();
