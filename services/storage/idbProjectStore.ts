/**
 * IdbProjectStore — Project / settings CRUD and state validation.
 * ENCRYPTION: AES-256-GCM via StorageEncryptionService when isIdbEncryptionReady() — else plaintext.
 * QNBS-v3: Extracted from dbService.ts. validateAndFixState is the canonical migration guard.
 *          Phase 2 B-1: encrypt/decrypt on every saveSlice / loadState call when key is active.
 */

import type { ProjectData } from '../../features/project/projectSlice';
import type { Settings, StoryProject } from '../../types';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../collaborationService';
import { APP_DATA_STORE } from '../dbConstants';
import type { SaveProjectInput } from '../storageBackend';
import { IdbAssetStore } from './idbAssetStore';
import { compressData, decompressData, getUserFriendlyDbError, retryDb } from './idbCore';
import {
  idbDecrypt,
  idbEncrypt,
  isEncryptedBlob,
  isIdbEncryptionReady,
} from './storageEncryptionService';

// Define structure of state stored in DB
interface PersistedProjectState {
  // Redux-undo shape for present state, or full undoable envelope
  data?: ProjectData; // Flattened structure often saved
  present?: { data: ProjectData }; // Structure if full slice saved
}

interface PersistedState {
  project?: PersistedProjectState;
  settings?: Settings;
}

export class IdbProjectStore extends IdbAssetStore {
  // Helper to validate state structure and fix common issues
  private validateAndFixState(project: unknown, settings: unknown): PersistedState | undefined {
    // If project is missing but we have settings, return partial to allow new user flow
    if (!project && !settings) return undefined;

    const validProject = project ? (project as PersistedProjectState) : undefined;

    // Ensure Project Structure consistency
    if (validProject) {
      const rawData = validProject.present ? validProject.present.data : validProject.data;
      if (rawData) {
        // Ensure projectGoals exists
        if (!rawData.projectGoals) {
          rawData.projectGoals = { totalWordCount: 50000, targetDate: null };
        }
        // Ensure writingHistory exists
        if (!rawData.writingHistory) {
          rawData.writingHistory = [];
        }
      }
    }

    // Ensure settings has defaults if missing keys
    let validSettings: Settings | undefined;
    if (settings) {
      const incoming = settings as Record<string, unknown>;
      validSettings = {
        theme: 'dark',
        appearancePreset: 'default',
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.6,
        aiCreativity: 'Balanced',
        paragraphSpacing: 1,
        indentFirstLine: false,
        ...incoming,
      } as Settings;
      validSettings.privacy = {
        analyticsEnabled: false,
        crashReporting: false,
        dataEncryption: true,
        localStorageOnly: true,
        shareUsageData: false,
        euDataResidency: true,
        ...(incoming['privacy'] as Partial<Settings['privacy']> | undefined),
      };
      const incomingCollab = incoming['collaboration'] as
        | Partial<Settings['collaboration']>
        | undefined;
      const collabDefaults: Settings['collaboration'] = {
        realTimeCollaboration: false,
        publicSharing: false,
        commentSystem: true,
        versionHistory: true,
        webrtcSignalingUrls: [...DEFAULT_WEBRTC_SIGNALING_URLS],
      };
      validSettings.collaboration = {
        ...collabDefaults,
        ...(incomingCollab ?? {}),
      };
      if (
        !validSettings.collaboration.webrtcSignalingUrls ||
        validSettings.collaboration.webrtcSignalingUrls.length === 0
      ) {
        validSettings.collaboration.webrtcSignalingUrls = [...DEFAULT_WEBRTC_SIGNALING_URLS];
      }
      const integrationsDefaults = {
        syncProvider: 'none' as const,
        evernoteSync: false,
        notionSync: false,
        scrivenerExport: false,
        googleDocsImport: false,
        languageToolEnabled: false,
        languageToolBaseUrl: 'http://localhost:8010',
      };
      validSettings.integrations = {
        ...integrationsDefaults,
        ...(incoming['integrations'] as Partial<Settings['integrations']> | undefined),
      };

      // QNBS-v3: Hybrid-AI-Felder nachziehen — ältere IndexedDB-Stände ohne neue Keys bleiben kompatibel.
      const advancedAiDefaults: Settings['advancedAi'] = {
        model: 'gemini-3.5-flash',
        provider: 'gemini',
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        customPrompts: {},
        rateLimit: 60,
        ollamaBaseUrl: 'http://localhost:11434',
        localBackendPreset: 'ollama_default',
        openAiCompatibleBaseUrl: '',
        openAiSiteUrl: '',
        openAiSiteTitle: 'StoryCraft Studio',
        hybridFallbackEnabled: false,
        hybridFallbackChain: [],
        ragMode: 'hybrid',
      };
      validSettings.advancedAi = {
        ...advancedAiDefaults,
        ...(incoming['advancedAi'] as Partial<Settings['advancedAi']> | undefined),
      };
    }

    const result: PersistedState = {};
    if (validProject) result.project = validProject;
    if (validSettings) result.settings = validSettings;
    return result;
  }

  async saveSlice(
    sliceName: 'project' | 'settings',
    data: PersistedProjectState | Settings,
  ): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    // QNBS-v3: Encrypt when session key is active; fall back to LZ compression otherwise.
    const payload = isIdbEncryptionReady() ? await idbEncrypt(data) : compressData(data);
    return new Promise((resolve, reject) => {
      const request = store.put(payload, sliceName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveProject(data: SaveProjectInput): Promise<void> {
    // Check auto-snapshot condition during save
    if (Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL) {
      // data may arrive as a Redux-undo envelope (PersistedProjectState) or plain StoryProject
      const persisted = data as PersistedProjectState;
      const projectData = persisted.present ? persisted.present.data : persisted.data;
      if (projectData?.manuscript) {
        this.lastAutoSnapshotTime = Date.now();
        // Fire and forget snapshot to not block UI
        this.createSnapshot(projectData).then(() => this.pruneAutoSnapshots());
      }
    }
    // QNBS-v3: retryDb guards against transient IDB errors (QuotaExceeded, AbortError, etc.).
    return retryDb(() => this.saveSlice('project', data as PersistedProjectState));
  }

  async saveSettings(data: Settings): Promise<void> {
    // QNBS-v3: retryDb guards against transient IDB errors on the settings save path.
    return retryDb(() => this.saveSlice('settings', data));
  }

  async loadState(): Promise<PersistedState | undefined> {
    return retryDb(async () => {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
      const projectRequest = store.get('project');
      const settingsRequest = store.get('settings');

      return new Promise<PersistedState | undefined>((resolve, reject) => {
        let project: unknown;
        let settings: unknown;
        let completed = 0;

        const onComplete = () => {
          if (++completed === 2) {
            const validated = this.validateAndFixState(project, settings);
            resolve(validated);
          }
        };

        projectRequest.onsuccess = async () => {
          const raw = projectRequest.result;
          // QNBS-v3: Decrypt encrypted blobs; fall back to decompressData for legacy plaintext.
          project =
            isEncryptedBlob(raw) && isIdbEncryptionReady()
              ? await idbDecrypt(raw)
              : decompressData(raw);
          onComplete();
        };
        settingsRequest.onsuccess = async () => {
          const raw = settingsRequest.result;
          settings =
            isEncryptedBlob(raw) && isIdbEncryptionReady()
              ? await idbDecrypt(raw)
              : decompressData(raw);
          onComplete();
        };

        projectRequest.onerror = () => reject(projectRequest.error);
        settingsRequest.onerror = () => reject(settingsRequest.error);
      });
    });
  }

  async hasSavedData(): Promise<boolean> {
    try {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
      const request = store.count();
      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(request.result > 0);
        };
        request.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  // --- StorageBackend: per-project methods (browser = single-project mode) ---

  async loadSettings(): Promise<Settings | null> {
    const state = await this.loadState();
    return state?.settings ?? null;
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    const state = await this.loadState();
    if (!state?.project) return null;
    const raw = state.project.present ? state.project.present.data : state.project.data;
    if (!raw) return null;
    // In browser mode there is exactly one active project; return it if the ID matches
    // (or if no ID is set yet, return it for any query — single-project behaviour).
    if (raw.id && raw.id !== projectId) return null;
    return raw as unknown as StoryProject;
  }

  async listProjects(): Promise<string[]> {
    const state = await this.loadState();
    if (!state?.project) return [];
    const raw = state.project.present ? state.project.present.data : state.project.data;
    if (!raw) return [];
    return [raw.id ?? 'browser-project'];
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.deleteAllBinderAssetsForProject(projectId);
    return retryDb(async () => {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const req = store.delete('project');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(getUserFriendlyDbError(req.error));
      });
    });
  }
}
