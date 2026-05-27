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

type ProjectStateWithHistory = {
  present?: { data?: ProjectData };
  data?: ProjectData;
};

export const listenerMiddleware = createListenerMiddleware();

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

      if (api.getState().featureFlags?.enableCrossProjectSearch && presentData.id) {
        const duckDbOn = api.getState().featureFlags?.enableDuckDbAnalytics ?? false;
        const { indexProject } = await import('../services/crossProjectIndexService');
        indexProject(presentData.id, enriched, duckDbOn).catch((err: unknown) =>
          logger.warn('Cross-project index update failed (non-critical):', err),
        );
      }

      if (api.getState().featureFlags?.enableDuckDbAnalytics) {
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
    if (!state.featureFlags?.enableCodexAutoTracking) return;

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

      if (state.featureFlags?.enableDuckDbAnalytics) {
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
      const { runIfNeeded } = await loadDuckdbMigration();
      await runIfNeeded(project);
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

export const startAppListening = listenerMiddleware.startListening as TypedStartListening<
  RootState,
  AppDispatch
>;
