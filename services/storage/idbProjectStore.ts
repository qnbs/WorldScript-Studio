/**
 * IdbProjectStore — Project / settings CRUD and state validation.
 * ENCRYPTION: AES-256-GCM via StorageEncryptionService when isIdbEncryptionReady() — else plaintext.
 * QNBS-v3: Extracted from dbService.ts. validateAndFixState is the canonical migration guard.
 *          Phase 2 B-1: encrypt/decrypt on every saveSlice / loadState call when key is active.
 */

import type { ProjectData } from '../../features/project/projectSlice';
import { normalizeAccessibilitySettings } from '../../features/settings/accessibilitySchema';
import { getDefaultKeyboardShortcuts } from '../../features/settings/keyboardShortcutsDefaults';
// QNBS-v3 (#190): import defaults from the side-effect-free module — settingsSlice runs
// applyInitialTheme() at load, so importing it from this low-level storage layer would touch the
// DOM/theme on any storage import (and break non-DOM runtimes).
import {
  defaultDesktopSettings,
  defaultVoiceSettings,
} from '../../features/settings/settingsDefaults';
import type { Settings, StoryProject } from '../../types';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../collaborationService';
import { APP_DATA_STORE } from '../dbConstants';
import { logger } from '../logger';
import type { SaveProjectInput } from '../storageBackend';
import { IdbAssetStore } from './idbAssetStore';
import { compressData, getUserFriendlyDbError, retryDb } from './idbCore';
import {
  assertIdbProtectedWriteAllowed,
  idbEncryptWithKey,
  idbReadSecure,
  resolveProtectedWriteKey,
} from './storageEncryptionService';

// ─── Exported for unit testing ────────────────────────────────────────────────

/**
 * Merges a raw (potentially incomplete) persisted settings object with safe defaults.
 * Exported so tests can verify migration behavior without opening IndexedDB.
 * QNBS-v3: Each sub-object is normalized separately to guard against absent fields
 * in IDB states saved by older app versions (pre-v1.8).
 */
export function normalizePersistedSettings(incoming: Record<string, unknown>): Settings {
  const validSettings = {
    theme: 'dark',
    appearancePreset: 'default',
    writingSurfaceStyle: 'textured',
    // QNBS-v3: aiMode added in v1.22 — backfill for older persisted settings that lack the field.
    aiMode: 'hybrid',
    editorFont: 'serif',
    fontSize: 16,
    lineSpacing: 1.6,
    aiCreativity: 'Balanced',
    paragraphSpacing: 1,
    indentFirstLine: false,
    ...incoming,
  } as Settings;

  // QNBS-v3: fantasy/romance presets removed in v1.22 — migrate legacy stored values to 'default'
  if (!['default', 'sepia'].includes(validSettings.appearancePreset)) {
    validSettings.appearancePreset = 'default';
  }
  if (!['textured', 'plain'].includes(validSettings.writingSurfaceStyle)) {
    validSettings.writingSurfaceStyle = 'textured';
  }

  validSettings.accessibility = normalizeAccessibilitySettings(incoming['accessibility']);

  const incomingPrivacy = incoming['privacy'] as Partial<Settings['privacy']> | undefined;
  // QNBS-v3: SEC — analytics default ON (local-only metadata, never leaves device), gated by
  // isAnalyticsPersistenceAllowed; persisted user choice overrides the default via the spread.
  validSettings.privacy = {
    analyticsEnabled: true,
    dataEncryption: true,
    localStorageOnly: true,
    euDataResidency: true,
    ...incomingPrivacy,
  };
  // QNBS-v3: SEC one-time migration — before the gate shipped, analyticsEnabled was cosmetic and
  // analytics persistence was controlled solely by enableDuckDbAnalytics (default on). Legacy persisted
  // settings therefore hold a meaningless analyticsEnabled (default false). On the FIRST load after this
  // upgrade, reset it to the new default (ON) to PRESERVE prior behavior; the marker then ensures every
  // subsequent load respects the user's real choice (so a future genuine opt-out is never re-flipped).
  if (incomingPrivacy?.analyticsGateMigrated !== true) {
    validSettings.privacy.analyticsEnabled = true;
  }
  validSettings.privacy.analyticsGateMigrated = true;

  const incomingCollab = incoming['collaboration'] as
    | Partial<Settings['collaboration']>
    | undefined;
  validSettings.collaboration = {
    webrtcSignalingUrls: [...DEFAULT_WEBRTC_SIGNALING_URLS],
    ...(incomingCollab ?? {}),
  };
  if (
    !validSettings.collaboration.webrtcSignalingUrls ||
    validSettings.collaboration.webrtcSignalingUrls.length === 0
  ) {
    validSettings.collaboration.webrtcSignalingUrls = [...DEFAULT_WEBRTC_SIGNALING_URLS];
  }

  validSettings.integrations = {
    languageToolEnabled: false,
    languageToolBaseUrl: 'http://localhost:8010',
    ...(incoming['integrations'] as Partial<Settings['integrations']> | undefined),
  };

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
    openAiSiteTitle: 'WorldScript Studio',
    hybridFallbackEnabled: false,
    hybridFallbackChain: [],
    ragMode: 'hybrid',
  };
  validSettings.advancedAi = {
    ...advancedAiDefaults,
    ...(incoming['advancedAi'] as Partial<Settings['advancedAi']> | undefined),
  };

  if (!Array.isArray(validSettings.keyboardShortcuts)) {
    validSettings.keyboardShortcuts = getDefaultKeyboardShortcuts();
  }
  if (!Array.isArray(validSettings.writingGoals)) {
    validSettings.writingGoals = [
      { type: 'words', target: 2000, period: 'daily', enabled: false },
      { type: 'time', target: 120, period: 'daily', enabled: false },
    ] as Settings['writingGoals'];
  }
  if (!validSettings.voice || typeof validSettings.voice !== 'object') {
    validSettings.voice = { ...defaultVoiceSettings };
  }
  // QNBS-v3 (T2/#190, T3): backfill the desktop group AND coerce each flag to a strict boolean —
  // imported/corrupted settings can carry a truthy non-boolean (e.g. the string "false"), which would
  // make close-to-tray / native notifications behave incorrectly.
  if (!validSettings.desktop || typeof validSettings.desktop !== 'object') {
    validSettings.desktop = { ...defaultDesktopSettings };
  } else {
    validSettings.desktop = {
      minimizeToTray: validSettings.desktop.minimizeToTray === true,
      desktopNotifications: validSettings.desktop.desktopNotifications === true,
    };
  }
  // QNBS-v3: openRouter added in OpenRouter integration — backfill for older persisted settings.
  if (!validSettings.openRouter || typeof validSettings.openRouter !== 'object') {
    validSettings.openRouter = {
      enabled: false,
      apiKey: '',
      preferredModel: 'deepseek/deepseek-r1:free',
    };
  }

  return validSettings;
}

// ─── Database structures ───────────────────────────────────────────────────────

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
    // QNBS-v3: Delegates to normalizePersistedSettings — exported for unit testing.
    const validSettings: Settings | undefined = settings
      ? normalizePersistedSettings(settings as Record<string, unknown>)
      : undefined;

    const result: PersistedState = {};
    if (validProject) result.project = validProject;
    if (validSettings) result.settings = validSettings;
    return result;
  }

  async saveSlice(
    sliceName: 'project' | 'settings',
    data: PersistedProjectState | Settings,
  ): Promise<void> {
    // QNBS-v3: Resolve the write key AND encrypt BEFORE opening the store — awaiting
    //          idbEncryptWithKey after getObjectStore would yield the event loop while the
    //          transaction is open, letting IDB auto-commit it before store.put runs
    //          (TransactionInactiveError); resolving the key first also removes the Lock-Session
    //          race, since the payload decision no longer depends on state read after an await.
    const writeKey = await resolveProtectedWriteKey();
    // QNBS-v3: Plaintext is allowed only when encryption was never configured for this library.
    const payload = writeKey ? await idbEncryptWithKey(writeKey, data) : compressData(data);
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
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
        // QNBS-v3: Only commit the timestamp after a successful snapshot — an unhandled rejection
        //          here (e.g. the expected locked-write error) previously suppressed the next
        //          automatic snapshot for a full interval even though none was actually taken.
        const snapshotTime = Date.now();
        // Fire and forget snapshot to not block UI
        this.createSnapshot(projectData)
          .then(() => {
            this.lastAutoSnapshotTime = snapshotTime;
            return this.pruneAutoSnapshots();
          })
          .catch((error: unknown) => {
            logger.warn('Automatic snapshot failed', { error: String(error) });
          });
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

        // QNBS-v3: IDBRequest.onsuccess is not awaited by the browser — an async handler whose
        //          promise rejects (e.g. idbReadSecure throwing IdbStorageLockedError) becomes an
        //          unhandled rejection instead of reaching this Promise's reject, leaving startup
        //          hydration pending forever instead of surfacing the locked-storage error.
        projectRequest.onsuccess = () => {
          const raw = projectRequest.result;
          // QNBS-v3: Decrypt encrypted blobs; fall back to decompressData for legacy plaintext.
          //          idbReadSecure throws a clear error if encrypted data is found without a key.
          idbReadSecure(raw)
            .then((value) => {
              project = value;
              onComplete();
            })
            .catch(reject);
        };
        settingsRequest.onsuccess = () => {
          const raw = settingsRequest.result;
          idbReadSecure(raw)
            .then((value) => {
              settings = value;
              onComplete();
            })
            .catch(reject);
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
    // QNBS-v3: Guard before the binder-asset cascade too — a locked session must not delete
    //          protected assets even indirectly via a project-delete request.
    await assertIdbProtectedWriteAllowed();
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
