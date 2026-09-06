/**
 * IdbProjectStore — Project / settings CRUD and state validation.
 * ENCRYPTION: AES-256-GCM via StorageEncryptionService when isIdbEncryptionReady() — else plaintext.
 * QNBS-v3: Extracted from dbService.ts. validateAndFixState is the canonical migration guard.
 *          Phase 2 B-1: encrypt/decrypt on every saveSlice / loadState call when key is active.
 */

import { observeProjectVersionClassificationFromObject } from '../../features/project/projectSchemaVersionShadow';
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
import type { OpenRouterSettings, Settings, StoryProject } from '../../types';
import {
  ANTHROPIC_MODEL_IDS,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GROK_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  GROK_MODEL_IDS,
  OPENAI_MODEL_IDS,
} from '../ai/cloudModelCatalog';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../collaborationService';
import { APP_DATA_STORE } from '../dbConstants';
import { logger } from '../logger';
import type { SaveProjectInput } from '../storageBackend';
import { IdbAssetStore } from './idbAssetStore';
import { compressData, getUserFriendlyDbError, retryDb } from './idbCore';
import { withProtectedWriteAdmission } from './protectedWriteAdmission';
import {
  assertIdbProtectedWriteAllowed,
  assertNoActiveEncryptionMigration,
  assertSecureStorageReadable,
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
    // QNBS-v3: must match settingsSlice.ts's initialState.appearancePreset — the two are the same product default and must never silently disagree about what "no persisted preference" means.
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

  // QNBS-v3: fantasy/romance presets removed in v1.22 — migrate any legacy stored value to the current default.
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
  // QNBS-v3: migrate stored cloud IDs removed from the selectable catalog to safe current defaults.
  if (
    validSettings.advancedAi.provider === 'anthropic' &&
    !ANTHROPIC_MODEL_IDS.includes(
      validSettings.advancedAi.model as (typeof ANTHROPIC_MODEL_IDS)[number],
    )
  ) {
    validSettings.advancedAi.model = DEFAULT_ANTHROPIC_MODEL_ID;
  } else if (
    validSettings.advancedAi.provider === 'openai' &&
    !OPENAI_MODEL_IDS.includes(validSettings.advancedAi.model as (typeof OPENAI_MODEL_IDS)[number])
  ) {
    validSettings.advancedAi.model = DEFAULT_OPENAI_MODEL_ID;
  } else if (
    validSettings.advancedAi.provider === 'grok' &&
    !GROK_MODEL_IDS.includes(validSettings.advancedAi.model as (typeof GROK_MODEL_IDS)[number])
  ) {
    validSettings.advancedAi.model = DEFAULT_GROK_MODEL_ID;
  }

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
  // QNBS-v3: rebuild (never trust-cast) openRouter every time — discards any legacy/imported apiKey (the real key lives only in the dedicated per-provider key store) and guarantees enabled/preferredModel are always present, even for a credentials-only legacy object like `{ apiKey: "..." }`.
  const incomingOpenRouter =
    validSettings.openRouter && typeof validSettings.openRouter === 'object'
      ? (validSettings.openRouter as unknown as Record<string, unknown>)
      : {};
  const rebuiltOpenRouter: OpenRouterSettings = {
    enabled: incomingOpenRouter['enabled'] === true,
    preferredModel:
      typeof incomingOpenRouter['preferredModel'] === 'string'
        ? incomingOpenRouter['preferredModel']
        : 'deepseek/deepseek-r1:free',
  };
  validSettings.openRouter = rebuiltOpenRouter;

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
      // QNBS-v3: falls back to the envelope itself so a flat/malformed present record (neither .present.data nor .data resolving) is still observed, not silently skipped, per contract section 2.8's universal ingress admission (observation-only, Slice B).
      observeProjectVersionClassificationFromObject(rawData ?? validProject, 'idb-project-load');
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
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: Resolve the write key AND encrypt BEFORE opening the store — awaiting
      //          idbEncryptWithKey after getObjectStore would yield the event loop while the
      //          transaction is open, letting IDB auto-commit it before store.put runs
      //          (TransactionInactiveError); resolving the key first also removes the Lock-Session
      //          race, since the payload decision no longer depends on state read after an await.
      const writeKey = await resolveProtectedWriteKey();
      // QNBS-v3: Plaintext is allowed only when encryption was never configured for this library.
      const payload = writeKey ? await idbEncryptWithKey(writeKey, data) : compressData(data);
      // QNBS-v3: only the migration guard is re-checked here — resolveProtectedWriteKey() already made its own lock check atomically with the key snapshot, so re-running that too would wrongly reject an already-safely-encrypted write if the session locks mid-write.
      await assertNoActiveEncryptionMigration();
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const request = store.put(payload, sliceName);
        const transaction = store.transaction;
        // QNBS-v3: resolve on transaction commit, not request success — onsuccess fires before the write is durable, which now matters since a caller can immediately reload.
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IDB transaction aborted'));
      });
    });
  }

  async saveProject(data: SaveProjectInput): Promise<void> {
    // QNBS-v3: autoSnapshotInFlight prevents a saveProject() call arriving before the first snapshot's success callback runs from starting a duplicate concurrent snapshot.
    if (
      !this.autoSnapshotInFlight &&
      Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL
    ) {
      // data may arrive as a Redux-undo envelope (PersistedProjectState) or plain StoryProject
      const persisted = data as PersistedProjectState;
      const projectData = persisted.present ? persisted.present.data : persisted.data;
      if (projectData?.manuscript) {
        // QNBS-v3: Only commit the timestamp after a successful snapshot — an unhandled rejection here previously suppressed the next automatic snapshot for a full interval even though none was actually taken.
        const snapshotTime = Date.now();
        this.autoSnapshotInFlight = true;
        // Fire and forget snapshot to not block UI
        this.createSnapshot(projectData)
          .then(() => {
            this.lastAutoSnapshotTime = snapshotTime;
            return this.pruneAutoSnapshots();
          })
          .catch((error: unknown) => {
            logger.warn('Automatic snapshot failed', { error: String(error) });
          })
          .finally(() => {
            this.autoSnapshotInFlight = false;
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
      await assertSecureStorageReadable();
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
    // QNBS-v3: one outer admission spans guard+cascade+delete; calls the cascade's unadmitted core since nesting the same lock name can deadlock behind a queued exclusive migration request.
    return withProtectedWriteAdmission(() =>
      retryDb(async () => {
        await assertIdbProtectedWriteAllowed();
        await this.deleteAllBinderAssetsForProjectUnadmitted(projectId);
        // QNBS-v3: re-checked immediately before the final mutation — the cascade above took real async time under the same admission hold, and a Lock Session (not a migration, which admission already excludes) could still fire during it.
        await assertIdbProtectedWriteAllowed();
        const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
        return new Promise<void>((resolve, reject) => {
          const req = store.delete('project');
          req.onsuccess = () => resolve();
          req.onerror = () => reject(getUserFriendlyDbError(req.error));
        });
      }),
    );
  }
}
