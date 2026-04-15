import type { StoryProject, Settings, ProjectSnapshot } from '../types';

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

  constructor() {
    this.backend = dbService;
    this.initializeBackend();
  }

  private async initializeBackend() {
    // Check if we're running in Tauri
    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        await fileSystemService.initialize();
        this.backend = fileSystemService;
        console.log('Using file system storage backend');
      } catch (error) {
        console.warn('Failed to initialize file system storage, falling back to IndexedDB:', error);
        this.backend = dbService;
      }
    } else {
      console.log('Using IndexedDB storage backend');
      this.backend = dbService;
    }
  }

  // Delegate all methods to the current backend
  async saveProject(project: unknown): Promise<void> {
    return (this.backend.saveProject as (p: unknown) => Promise<void>)(project);
  }

  async loadProject(_projectId: string): Promise<StoryProject | null> {
    if ('loadProject' in this.backend) {
      return (this.backend as StorageBackend).loadProject(_projectId);
    }
    return null;
  }

  async listProjects(): Promise<string[]> {
    if ('listProjects' in this.backend) {
      return (this.backend as StorageBackend).listProjects();
    }
    return [];
  }

  async deleteProject(_projectId: string): Promise<void> {
    if ('deleteProject' in this.backend) {
      return (this.backend as StorageBackend).deleteProject(_projectId);
    }
  }

  async saveImage(id: string, base64Data: string): Promise<void> {
    return this.backend.saveImage(id, base64Data);
  }

  async getImage(id: string): Promise<string | null> {
    return this.backend.getImage(id);
  }

  async saveSettings(settings: Settings): Promise<void> {
    return this.backend.saveSettings(settings);
  }

  async loadSettings(): Promise<Settings | null> {
    if (
      'loadSettings' in this.backend &&
      typeof (this.backend as StorageBackend).loadSettings === 'function'
    ) {
      return (this.backend as StorageBackend).loadSettings();
    }
    return null;
  }

  async saveGeminiApiKey(apiKey: string): Promise<void> {
    return this.backend.saveGeminiApiKey(apiKey);
  }

  async getGeminiApiKey(): Promise<string | null> {
    return this.backend.getGeminiApiKey();
  }

  async clearGeminiApiKey(): Promise<void> {
    return this.backend.clearGeminiApiKey();
  }

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    return this.backend.saveApiKey(provider, apiKey);
  }

  async getApiKey(provider: string): Promise<string | null> {
    return this.backend.getApiKey(provider);
  }

  async clearApiKey(provider: string): Promise<void> {
    return this.backend.clearApiKey(provider);
  }

  async saveSnapshot(name: string, data: unknown): Promise<void> {
    if ('saveSnapshot' in this.backend) {
      return (this.backend as StorageBackend).saveSnapshot(name, data);
    }
    // IndexedDB backend uses createSnapshot(data, name)
    return this.backend.createSnapshot(
      data as Parameters<typeof this.backend.createSnapshot>[0],
      name
    );
  }

  async getSnapshotData(id: number): Promise<unknown> {
    return (this.backend.getSnapshotData as (i: number) => Promise<unknown>)(id);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    const result = await this.backend.listSnapshots();
    return result as ProjectSnapshot[];
  }

  async deleteSnapshot(id: number): Promise<void> {
    return (this.backend.deleteSnapshot as (i: number) => Promise<void>)(id);
  }
}

export const storageService = new StorageManager();
