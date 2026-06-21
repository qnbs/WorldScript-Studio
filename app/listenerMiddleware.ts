import type { TypedStartListening } from '@reduxjs/toolkit';
import { createListenerMiddleware, isRejected } from '@reduxjs/toolkit';
import { analyticsActions } from '../features/analytics/analyticsSlice';
import type { ProjectData } from '../features/project/projectSlice';
import { statusActions } from '../features/status/statusSlice';
import { extractStoryCodex, saveStoryCodex } from '../services/codexService';
import { checkStorageHealth } from '../services/dbInitialization';
import {
  loadDuckdbAnalytics,
  loadDuckdbMigration,
  loadLocalRagService,
  loadRagVectorMigration,
} from '../services/duckdb/duckdbListenerLoader';
import { logger } from '../services/logger';
import { saveEnvelopeFromProjectData } from '../services/storageBackend';
import { storageService } from '../services/storageService';
import type { Character, StorySection, World } from '../types';
import type { AppDispatch, RootState } from './store';
import { appStoreRef } from './storeRef';

type ProjectStateWithHistory = {
  present?: { data?: ProjectData };
  data?: ProjectData;
};

export const listenerMiddleware = createListenerMiddleware();

// QNBS-v3: SEC — DuckDB analytics persistence requires BOTH the feature flag (enableDuckDbAnalytics)
// AND the user-facing Settings → Privacy "Analytics" opt-out (settings.privacy.analyticsEnabled).
// Before this gate the privacy toggle was cosmetic — only the flag controlled writes. Analytics data
// is local-only metadata (titles/loglines/word-counts/codex excerpts; never manuscript prose), but a
// privacy toggle that does nothing is a dark pattern. Single source of truth for every write site.
export function isAnalyticsPersistenceAllowed(state: RootState): boolean {
  return (
    Boolean(state.featureFlags?.enableDuckDbAnalytics) && state.settings.privacy.analyticsEnabled
  );
}

// QNBS-v3: Listener categories in this file:
//   1. Auto-Save        — project data + version control → IDB (debounced 1s)
//   2. Auto-Track       — Codex extraction (always-on; promoted from enableCodexAutoTracking flag)
//   3. RAG Index        — incremental re-embedding on manuscript edits (debounced 3s)
//   4. DuckDB Dual-Write — analytics tables updated on save (when enableDuckDbAnalytics)
//   5. Storage Health   — quota check before every save
//   6. Cross-Project    — search index updated on save (always-on; promoted from enableCrossProjectSearch flag)
//   7. WorkerBus v2     — init/shutdown pools on enableWorkerBusV2 flag change (Phase 2)
//   8. Rust Compute     — invalidate Rust availability cache on enableRustCompute toggle (Phase 2)
//
// All AI inference side effects (local/cloud) are intentionally NOT in this middleware —
// they belong in service-layer thunks (aiProviderService, localAiFacade) to keep the
// middleware focused on persistence and indexing.

// QNBS-v3: Factory for the common debounce-listener pattern — predicate + delay + typed effect.
// Eliminates the RootState cast dance repeated across 3 auto-save / auto-track listeners.
type DebouncedEffectApi = {
  getState: () => RootState;
  getOriginalState: () => RootState;
  dispatch: AppDispatch;
  delay: (ms: number) => Promise<void>;
};

function addDebouncedListener(
  predicate: (curr: RootState, prev: RootState) => boolean,
  delayMs: number,
  effect: (api: DebouncedEffectApi) => Promise<void>,
): void {
  listenerMiddleware.startListening({
    predicate: (_action, curr, prev) => predicate(curr as RootState, prev as RootState),
    effect: async (_action, listenerApi) => {
      // QNBS-v3: RTK requires getOriginalState to be called synchronously (before first await).
      const originalState = listenerApi.getOriginalState() as RootState;
      // QNBS-v3: True debounce — cancel any concurrent instances so only the last burst's
      // invocation runs after the delay window. Without this, 50 rapid dispatches produce 50 saves.
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(delayMs);
      await effect({
        getState: () => listenerApi.getState() as RootState,
        getOriginalState: () => originalState,
        dispatch: listenerApi.dispatch as AppDispatch,
        delay: (ms) => listenerApi.delay(ms),
      });
    },
  });
}

// --- 1a. Auto-Save: Project ---
addDebouncedListener(
  (curr, prev) => {
    const projectChanged = curr.project?.present !== prev.project?.present;
    const vcChanged =
      curr.versionControl?.snapshots !== prev.versionControl?.snapshots ||
      curr.versionControl?.branches !== prev.versionControl?.branches ||
      curr.versionControl?.currentBranchId !== prev.versionControl?.currentBranchId;
    return projectChanged || vcChanged;
  },
  1000,
  async (api) => {
    const state = api.getState();
    const orig = api.getOriginalState();
    const unchangedProject = state.project.present === orig.project.present;
    const unchangedVc =
      state.versionControl.snapshots === orig.versionControl.snapshots &&
      state.versionControl.branches === orig.versionControl.branches &&
      state.versionControl.currentBranchId === orig.versionControl.currentBranchId;
    if (unchangedProject && unchangedVc) return;

    api.dispatch(statusActions.setSavingStatus('saving'));

    // QNBS-v3: Proactive storage health check before every save — warn early if quota is tight.
    try {
      const health = await checkStorageHealth();
      if (!health.ok && health.warning) {
        api.dispatch(
          statusActions.addNotification({
            type: 'error',
            title: 'Storage Nearly Full',
            description: health.warning,
          }),
        );
      }
    } catch {
      /* non-critical — don't block save if health check itself fails */
    }

    try {
      const projectState = state.project as ProjectStateWithHistory;
      const presentData = projectState.present?.data ?? projectState.data;

      if (!presentData || presentData.title === undefined) {
        logger.error('Auto-save aborted: Invalid project state detected (missing present.data)');
        api.dispatch(statusActions.setSavingStatus('idle'));
        return;
      }

      const enriched: ProjectData = {
        ...presentData,
        persistedVersionControl: {
          branches: state.versionControl.branches,
          snapshots: state.versionControl.snapshots,
          currentBranchId: state.versionControl.currentBranchId,
        },
      };

      const projectDataToSave = saveEnvelopeFromProjectData(enriched);

      try {
        const serialized = JSON.stringify(projectDataToSave);
        if (serialized.length > 5 * 1024 * 1024) {
          logger.warn(
            `Auto-save: Project size is ${(serialized.length / 1024 / 1024).toFixed(1)} MB. Consider exporting and archiving.`,
          );
        }
      } catch {
        /* non-critical */
      }

      await storageService.saveProject(projectDataToSave);

      // QNBS-v3: enableCrossProjectSearch promoted to permanent core — always index on save.
      if (presentData.id) {
        const duckDbOn = api.getState().featureFlags?.enableDuckDbAnalytics ?? false;
        const { indexProject } = await import('../services/crossProjectIndexService');
        indexProject(presentData.id, enriched, duckDbOn).catch((err: unknown) =>
          logger.warn('Cross-project index update failed (non-critical):', err),
        );
      }

      if (isAnalyticsPersistenceAllowed(api.getState())) {
        const projectId = presentData.id ?? 'default';
        const sections = presentData.manuscript.map((s, idx) => ({
          id: s.id,
          title: s.title,
          wordCount: (s.content?.match(/\S+/g) ?? []).length,
          status: s.status,
          position: idx,
          scene_start: s.sceneStart,
        }));
        const totalWordCount = sections.reduce((acc, s) => acc + s.wordCount, 0);
        const { duckdbDualWrite, withDuckDbRetry } = await loadDuckdbAnalytics();
        void withDuckDbRetry(() =>
          duckdbDualWrite(
            projectId,
            presentData.title,
            presentData.logline,
            totalWordCount,
            presentData.projectGoals?.totalWordCount,
            presentData.projectGoals?.targetDate,
            presentData.writingHistory ?? [],
            sections,
          ),
        ).catch((err: unknown) =>
          logger.warn('DuckDB dual-write failed after retries (non-critical):', err),
        );
      }

      api.dispatch(statusActions.setSavingStatus('saved'));
      await api.delay(2000);
      if (api.getState().status.saving === 'saved') {
        api.dispatch(statusActions.setSavingStatus('idle'));
      }
    } catch (error) {
      // QNBS-v3: TaskAbortError = a newer debounce cycle cancelled us AFTER the save already
      // succeeded (at the api.delay(2000) cleanup step). The data is safe — just reset status.
      if ((error as { name?: string }).name === 'TaskAbortError') {
        api.dispatch(statusActions.setSavingStatus('idle'));
        return;
      }
      logger.error('Auto-save (project) failed:', error);
      api.dispatch(
        statusActions.addNotification({
          type: 'error',
          title: 'Auto-Save Failed',
          description: 'Your changes could not be saved to the local database.',
        }),
      );
      api.dispatch(statusActions.setSavingStatus('idle'));
    }
  },
);

// --- 1b. Auto-Save: Settings ---
addDebouncedListener(
  (curr, prev) => curr.settings !== prev.settings,
  1000,
  async (api) => {
    const state = api.getState();
    if (state.settings === api.getOriginalState().settings) return;

    try {
      await storageService.saveSettings(state.settings);
    } catch (error) {
      logger.error('Auto-save (settings) failed:', error);
      // QNBS-v3: Mirror the project auto-save toast so the user knows settings weren't persisted.
      api.dispatch(
        statusActions.addNotification({
          type: 'error',
          title: 'Auto-Save Failed',
          description: 'Settings could not be saved to the local database.',
        }),
      );
    }
  },
);

// --- 1c. Codex Auto-Tracking ---
addDebouncedListener(
  (curr, prev) =>
    curr.project?.present?.data?.manuscript !== prev.project?.present?.data?.manuscript,
  1200,
  async (api) => {
    const state = api.getState();
    // QNBS-v3: enableCodexAutoTracking promoted to permanent core — Codex always auto-tracks.
    const project = state.project.present?.data;
    if (!project) return;

    const projectId = project.id || 'default';
    const characters = Object.values(project.characters.entities).filter(Boolean) as Character[];
    const worlds = Object.values(project.worlds.entities).filter(Boolean) as World[];

    const binderResearchSections: StorySection[] = (project.binderNodes ?? [])
      .filter(
        (n) =>
          (n.type === 'note' || n.type === 'text') &&
          typeof n.content === 'string' &&
          n.content.trim(),
      )
      .map((n) => ({
        id: `binder-${n.id}`,
        title: `Research: ${n.title}`,
        content: n.content ?? '',
      }));

    try {
      const codex = extractStoryCodex(
        projectId,
        project.manuscript,
        characters,
        worlds,
        { advanced: state.featureFlags?.enableStoryBibleAdvanced ?? false },
        binderResearchSections,
      );
      await saveStoryCodex(codex);

      if (isAnalyticsPersistenceAllowed(state)) {
        const entities = codex.entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          mentionCount: e.mentionCount,
          mentions: e.mentions.map((m) => ({ sectionId: m.sectionId, excerpt: m.excerpt })),
        }));
        const { duckdbCodexWrite, withDuckDbRetry } = await loadDuckdbAnalytics();
        void withDuckDbRetry(() => duckdbCodexWrite(projectId, entities)).catch((err: unknown) =>
          logger.warn('DuckDB codex write failed after retries (non-critical):', err),
        );
      }
    } catch (error) {
      logger.warn('Story Codex auto-tracking failed:', error);
    }
  },
);

listenerMiddleware.startListening({
  matcher: isRejected,
  effect: (action, listenerApi) => {
    if (action.meta.aborted) return;

    let errorDescription = action.error?.message ?? 'An unexpected error occurred.';
    if (errorDescription.includes('quota') || errorDescription.includes('API key')) {
      errorDescription = 'AI Service Error: Please check your API key and quota.';
    }

    listenerApi.dispatch(
      statusActions.addNotification({
        type: 'error',
        title: 'Operation Failed',
        description: errorDescription,
      }),
    );
  },
});

listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = currentState as RootState;
    const prev = previousState as RootState;
    return (
      curr.featureFlags?.enableDuckDbAnalytics === true &&
      curr.analytics?.duckDbStatus === 'ready' &&
      curr.analytics?.migrationStatus === 'idle' &&
      prev.analytics?.duckDbStatus !== 'ready'
    );
  },
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const project = state.project.present?.data;
    if (!project) return;

    listenerApi.dispatch(analyticsActions.setMigrationStatus('running'));
    try {
      const { runMigrationWithRollback } = await loadDuckdbMigration();
      await runMigrationWithRollback(project);
      const projectId = project.id || 'default';
      const { runRagVectorMigration } = await loadRagVectorMigration();
      await runRagVectorMigration(projectId, project.manuscript);
      listenerApi.dispatch(analyticsActions.setMigrationStatus('done'));
      listenerApi.dispatch(analyticsActions.setLastSyncAt(new Date().toISOString()));
    } catch (err) {
      listenerApi.dispatch(
        analyticsActions.setMigrationError(err instanceof Error ? err.message : String(err)),
      );
    }
  },
});

listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = currentState as RootState;
    const prev = previousState as RootState;
    return curr.project?.present?.data?.manuscript !== prev.project?.present?.data?.manuscript;
  },
  effect: async (_action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(5000);

    const state = listenerApi.getState() as RootState;
    const project = state.project.present?.data;
    if (!project) return;

    const projectId = project.id || 'default';
    const duckDbOn = state.featureFlags?.enableDuckDbAnalytics ?? false;
    try {
      const { rebuildHybridRagIndex } = await loadLocalRagService();
      await rebuildHybridRagIndex(projectId, project.manuscript, duckDbOn);
    } catch (err) {
      logger.warn('RAG auto-rebuild failed (non-critical):', err);
    }
  },
});

// QNBS-v3: B4 — Adaptive AI engine activation listener.
// On flag enable: set window flag + generate device profile.
// On flag disable: release GPU resources + invalidate cached profile.
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = (currentState as RootState).featureFlags;
    const prev = (previousState as RootState).featureFlags;
    return curr?.enableAdaptiveAiEngine === true && prev?.enableAdaptiveAiEngine !== true;
  },
  effect: async () => {
    // QNBS-v3: guard for SSR / worker contexts where window is not defined
    if (typeof window !== 'undefined') {
      window.__worldscript_adaptive_ai__ = true;
    }
    try {
      const { generateDeviceProfile } = await import('../services/ai/localAiDeviceProfiler');
      await generateDeviceProfile();
      logger.info('Adaptive AI engine enabled — device profile generated');
    } catch (err) {
      logger.warn('Adaptive AI device profile generation failed', err);
    }
  },
});

listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = (currentState as RootState).featureFlags;
    const prev = (previousState as RootState).featureFlags;
    return curr?.enableAdaptiveAiEngine !== true && prev?.enableAdaptiveAiEngine === true;
  },
  effect: async () => {
    // QNBS-v3: guard for SSR / worker contexts where window is not defined
    if (typeof window !== 'undefined') {
      window.__worldscript_adaptive_ai__ = false;
    }
    try {
      const [aiCore, profiler] = await Promise.all([
        import('@domain/ai-core'),
        import('../services/ai/localAiDeviceProfiler'),
      ]);
      aiCore.releaseAllWebLlmEngines();
      // QNBS-v3: releaseAllOnnxSessions is async — must await to ensure GPU session cleanup
      //          completes before the engine is re-enabled (avoids dangling WASM handles)
      await aiCore.releaseAllOnnxSessions();
      profiler.invalidateDeviceProfile();
      logger.info('Adaptive AI engine disabled — GPU resources released');
    } catch (err) {
      logger.warn('Adaptive AI cleanup failed', err);
    }
  },
});

/**
 * QNBS-v3: Issue 5 — On cold-start the listener only fires on flag OFF→ON transitions.
 * If enableAdaptiveAiEngine is already true in localStorage/persisted state, set the
 * window gate immediately so localAiFacade uses the adaptive path from the first call.
 */
export function initAdaptiveAiOnStartup(enabled: boolean): void {
  if (!enabled) return;
  if (typeof window !== 'undefined') {
    window.__worldscript_adaptive_ai__ = true;
  }
  // Profile generation is handled by useAdaptiveAi on first mount
  logger.info('Adaptive AI engine: window gate set on cold start');
}

// QNBS-v3: Phase 2 — WorkerBus v2 activation listener.
// ON: lazily initialize WorkerBus and register worker pools.
// OFF: terminate all pools and free worker threads.
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = (currentState as RootState).featureFlags;
    const prev = (previousState as RootState).featureFlags;
    return curr?.enableWorkerBusV2 === true && prev?.enableWorkerBusV2 !== true;
  },
  effect: async () => {
    try {
      const { initWorkerBus } = await import('../services/workerBusManager');
      await initWorkerBus();
      logger.info('WorkerBus v2 enabled via feature flag');
    } catch (err) {
      logger.warn('WorkerBus v2 init on flag enable failed', err);
    }
  },
});

listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = (currentState as RootState).featureFlags;
    const prev = (previousState as RootState).featureFlags;
    return curr?.enableWorkerBusV2 !== true && prev?.enableWorkerBusV2 === true;
  },
  effect: async () => {
    try {
      const { shutdownWorkerBus } = await import('../services/workerBusManager');
      await shutdownWorkerBus();
      logger.info('WorkerBus v2 shut down via feature flag');
    } catch (err) {
      logger.warn('WorkerBus v2 shutdown on flag disable failed', err);
    }
  },
});

// QNBS-v3: Phase 2 — Rust Compute flag listener.
// Invalidates the Rust availability cache so the next routeTask() call re-pings the
// Rust TaskSupervisor instead of serving a stale cached result.
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = (currentState as RootState).featureFlags;
    const prev = (previousState as RootState).featureFlags;
    return curr?.enableRustCompute !== prev?.enableRustCompute;
  },
  effect: async () => {
    try {
      const { invalidateRustAvailabilityCache } = await import('../services/hybridRouter');
      invalidateRustAvailabilityCache();
      logger.info('Rust compute flag changed — availability cache invalidated');
    } catch (err) {
      logger.warn('Rust availability cache invalidation failed', err);
    }
  },
});

/**
 * QNBS-v3: Phase 2 — Cold-start WorkerBus v2 init. Mirrors initAdaptiveAiOnStartup:
 * listeners only fire on transitions, so if the flag was already true in persisted state
 * we must initialize synchronously on startup before the first task can be enqueued.
 */
export async function initWorkerBusOnStartup(enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    const { initWorkerBus } = await import('../services/workerBusManager');
    await initWorkerBus();
    logger.info('WorkerBus v2: pools initialized on cold start');
  } catch (err) {
    logger.warn('WorkerBus v2 cold-start init failed', err);
  }
}

// QNBS-v3: Reconcile transient UI state after project mutations/undo/redo.
// When binderNodes change (e.g. section deleted then undone), the pinned node ID
// in Zustand may point to a node that no longer exists. Clear it to avoid stale references.
listenerMiddleware.startListening({
  predicate: (_action, curr, prev) => {
    const currNodes = (curr as RootState).project?.present?.data?.binderNodes;
    const prevNodes = (prev as RootState).project?.present?.data?.binderNodes;
    return currNodes !== prevNodes;
  },
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const { manuscriptPinnedBinderNodeId, setManuscriptPinnedBinderNodeId } = (
      await import('./transientUiStore')
    ).useTransientUiStore.getState();
    if (!manuscriptPinnedBinderNodeId) return;

    const nodes = state.project?.present?.data?.binderNodes ?? [];
    const stillExists = nodes.some((n) => n.id === manuscriptPinnedBinderNodeId);
    if (!stillExists) {
      setManuscriptPinnedBinderNodeId(null);
      logger.info(
        'Reconcile: cleared manuscriptPinnedBinderNodeId — node no longer exists after project change',
      );
    }
  },
});

// QNBS-v3: Sync AI execution mode from Redux settings into both routing singletons.
// aiModeService drives provider routing; ecoModeService drives voice/adaptive-AI/GPU consumers.
// Both must stay in lock-step to prevent silent eco-mode divergence (G3 bridge).
listenerMiddleware.startListening({
  predicate: (_action, curr, prev) => {
    return (curr as RootState).settings?.aiMode !== (prev as RootState).settings?.aiMode;
  },
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const mode = state.settings?.aiMode ?? 'hybrid';
    const { setActiveAiMode } = await import('../services/ai/aiModeService');
    setActiveAiMode(mode);
    // QNBS-v3: Bridge eco mode — keeps voice/adaptive-AI/GpuMetricsPanel consumers in sync.
    const { ecoModeService } = await import('../services/ai/ecoModeService');
    ecoModeService.setAiModeEco(mode === 'eco');
  },
});

// QNBS-v3: Sync OpenRouter config into aiModeService when enabled flag or preferred model changes.
listenerMiddleware.startListening({
  predicate: (_action, curr, prev) => {
    const c = (curr as RootState).settings?.openRouter;
    const p = (prev as RootState).settings?.openRouter;
    return c?.enabled !== p?.enabled || c?.preferredModel !== p?.preferredModel;
  },
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const or = state.settings?.openRouter;
    const { setOpenRouterConfig } = await import('../services/ai/aiModeService');
    setOpenRouterConfig(or?.enabled ?? false, or?.preferredModel ?? 'deepseek/deepseek-r1:free');
  },
});

// QNBS-v3: B1.1 — Local-First shadow sync (ADR-0008). When enableLocalFirstSync is on, mirror the
// authoritative Redux project into a per-project Yjs doc (+ y-indexeddb). Redux stays the source of
// truth: on any read-verify drift we self-heal via full re-projection and only log (never surface to
// the user). All local-first modules are dynamically imported so they stay out of the main bundle.
type LocalFirstHandle = {
  projectId: string;
  binding: import('../services/localFirst/docBinding').ProjectDocBinding;
  persistence: import('../services/localFirst/docPersistence').DocPersistence;
};
let localFirstHandle: LocalFirstHandle | null = null;

// QNBS-v3 (CodeAnt): serialize all handle create/teardown so an overlapping sync run and an
// enable/disable run can't race on the shared module-global and leave the wrong handle active.
let localFirstLock: Promise<void> = Promise.resolve();
function withLocalFirstLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = localFirstLock.then(fn, fn);
  localFirstLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function getLocalFirstHandle(project: ProjectData): Promise<LocalFirstHandle> {
  return withLocalFirstLock(async () => {
    const projectId = project.id ?? 'default';
    const { isIdbEncryptionReady } = await import('../services/storage/storageEncryptionService');
    if (localFirstHandle?.projectId === projectId) {
      // QNBS-v3 (CodeAnt): the persistence backend (NOOP vs y-indexeddb) is chosen at handle
      // creation. If at-rest encryption became active AFTER a plaintext-persisting handle was made,
      // tear it down — wiping the plaintext already written — so no further plaintext is persisted.
      if (isIdbEncryptionReady() && localFirstHandle.persistence.active) {
        await localFirstHandle.persistence.clearData().catch(() => undefined);
        await localFirstHandle.persistence.destroy().catch(() => undefined);
        localFirstHandle = null;
      } else {
        return localFirstHandle;
      }
    } else if (localFirstHandle) {
      // Project switched — tear down the previous handle before creating a new one.
      await localFirstHandle.persistence.destroy().catch(() => undefined);
      localFirstHandle = null;
    }
    const [
      { createBlankProjectDoc },
      { ProjectDocBinding },
      { persistProjectDoc, NOOP_PERSISTENCE },
    ] = await Promise.all([
      import('../services/localFirst/projectDoc'),
      import('../services/localFirst/docBinding'),
      import('../services/localFirst/docPersistence'),
    ]);
    const doc = createBlankProjectDoc();
    // QNBS-v3 (CodeAnt): never write a PLAINTEXT shadow copy to y-indexeddb when at-rest encryption
    // is active — the local-first doc is not encrypted yet. Keep it in-memory only so the privacy
    // guarantee holds; shadow-sync still validates against Redux (SoT).
    const persistence = isIdbEncryptionReady()
      ? NOOP_PERSISTENCE
      : persistProjectDoc(projectId, doc);
    await persistence.whenSynced; // load any persisted state first …
    const binding = new ProjectDocBinding(project, doc); // … then project Redux over it (SoT wins)
    localFirstHandle = { projectId, binding, persistence };
    return localFirstHandle;
  });
}

function teardownLocalFirst(): Promise<void> {
  return withLocalFirstLock(async () => {
    const handle = localFirstHandle;
    localFirstHandle = null;
    if (handle) await handle.persistence.destroy().catch(() => undefined);
  });
}

// Shared shadow-sync run — used by both the debounced edit listener and the OFF→ON enable listener.
// `stillEnabled` is re-evaluated AFTER the async handle init so a sync that was in flight when the
// user disabled the flag aborts instead of resurrecting a torn-down binding.
async function runLocalFirstShadowSync(
  state: RootState,
  stillEnabled: () => boolean,
): Promise<void> {
  if (state.featureFlags?.enableLocalFirstSync !== true) return;
  const projectState = state.project as ProjectStateWithHistory;
  const presentData = projectState.present?.data ?? projectState.data;
  if (!presentData || presentData.title === undefined) return;
  try {
    const handle = await getLocalFirstHandle(presentData);
    // QNBS-v3 (CodeAnt): flag may have flipped off during the await — re-check before mutating.
    if (!stillEnabled()) return;
    handle.binding.syncFromProject(presentData);
    const result = handle.binding.verify(presentData);
    if (!result.ok) {
      // Shadow phase: never affect the user. Log a count (no ids/content → no PII) and self-heal.
      logger.warn('Local-First shadow drift — self-healing via re-projection', {
        mismatchCount: result.mismatches.length,
      });
      handle.binding.reproject(presentData);
    }
  } catch (err) {
    logger.warn('Local-First shadow sync failed (non-critical):', err);
  }
}

addDebouncedListener(
  (curr, prev) =>
    curr.featureFlags?.enableLocalFirstSync === true &&
    curr.project?.present !== prev.project?.present,
  1200,
  async (api) => {
    await runLocalFirstShadowSync(
      api.getState(),
      () => api.getState().featureFlags?.enableLocalFirstSync === true,
    );
  },
);

// QNBS-v3 (CodeAnt): OFF→ON must perform an immediate initial projection — otherwise the shadow doc
// stays uninitialized until the user happens to make another edit.
listenerMiddleware.startListening({
  predicate: (_action, curr, prev) =>
    (curr as RootState).featureFlags?.enableLocalFirstSync === true &&
    (prev as RootState).featureFlags?.enableLocalFirstSync !== true,
  effect: async (_action, listenerApi) => {
    await runLocalFirstShadowSync(
      listenerApi.getState() as RootState,
      () => (listenerApi.getState() as RootState).featureFlags?.enableLocalFirstSync === true,
    );
  },
});

// Tear down the shadow binding when the flag is turned off.
listenerMiddleware.startListening({
  predicate: (_action, curr, prev) =>
    (curr as RootState).featureFlags?.enableLocalFirstSync !== true &&
    (prev as RootState).featureFlags?.enableLocalFirstSync === true,
  effect: async () => {
    await teardownLocalFirst();
    logger.info('Local-First shadow sync disabled — binding torn down');
  },
});

// QNBS-v3 (CodeAnt): cold-start init — when enableLocalFirstSync is already true in persisted state,
// neither the edit listener nor the OFF→ON listener fires, so the shadow doc would stay uninitialized
// until the next edit. Call this once on mount (App.tsx) to run an initial projection + verify.
export async function initLocalFirstSyncOnStartup(enabled: boolean): Promise<void> {
  if (!enabled) return;
  const store = appStoreRef.current;
  if (!store) return;
  await runLocalFirstShadowSync(
    store.getState(),
    () => store.getState().featureFlags?.enableLocalFirstSync === true,
  );
}

export const startAppListening = listenerMiddleware.startListening as TypedStartListening<
  RootState,
  AppDispatch
>;
