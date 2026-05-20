import type { TypedStartListening } from '@reduxjs/toolkit';
import { createListenerMiddleware, isRejected } from '@reduxjs/toolkit';
import { analyticsActions } from '../features/analytics/analyticsSlice';
import type { ProjectData } from '../features/project/projectSlice';
import { statusActions } from '../features/status/statusSlice';
import { extractStoryCodex, saveStoryCodex } from '../services/codexService';
import { indexProject } from '../services/crossProjectIndexService';
import { duckdbCodexWrite, duckdbDualWrite } from '../services/duckdb/duckdbAnalytics';
import { runIfNeeded as duckdbMigrateIfNeeded } from '../services/duckdb/duckdbMigration';
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

// --- 1a. Auto-Save: Project ---
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const currentRoot = currentState as RootState;
    const prevRoot = previousState as RootState;
    const projectChanged = currentRoot.project.present !== prevRoot.project.present;
    const vcChanged =
      currentRoot.versionControl.snapshots !== prevRoot.versionControl.snapshots ||
      currentRoot.versionControl.branches !== prevRoot.versionControl.branches ||
      currentRoot.versionControl.currentBranchId !== prevRoot.versionControl.currentBranchId;
    return projectChanged || vcChanged;
  },
  effect: async (_action, listenerApi) => {
    const originalState = listenerApi.getOriginalState() as RootState;
    await listenerApi.delay(1000);

    const state = listenerApi.getState() as RootState;
    const orig = originalState as RootState;
    const unchangedProject = state.project.present === orig.project.present;
    const unchangedVc =
      state.versionControl.snapshots === orig.versionControl.snapshots &&
      state.versionControl.branches === orig.versionControl.branches &&
      state.versionControl.currentBranchId === orig.versionControl.currentBranchId;
    if (unchangedProject && unchangedVc) return;

    listenerApi.dispatch(statusActions.setSavingStatus('saving'));

    try {
      const projectState = state.project as ProjectStateWithHistory;
      const presentData = projectState.present?.data ?? projectState.data;

      if (!presentData || presentData.title === undefined) {
        logger.error('Auto-save aborted: Invalid project state detected (missing present.data)');
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
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
        /* non-critical — proceed with save */
      }

      await storageService.saveProject(projectDataToSave);

      // QNBS-v3: Index project metadata for cross-project search (privacy-preserving, behind flag).
      if (
        (listenerApi.getState() as RootState).featureFlags.enableCrossProjectSearch &&
        presentData.id
      ) {
        const duckDbOn = (listenerApi.getState() as RootState).featureFlags.enableDuckDbAnalytics;
        indexProject(presentData.id, enriched, duckDbOn).catch((err: unknown) =>
          logger.warn('Cross-project index update failed (non-critical):', err),
        );
      }

      // QNBS-v3: Dual-write plaintext analytics columns to DuckDB (non-blocking, fire-and-forget).
      if ((listenerApi.getState() as RootState).featureFlags.enableDuckDbAnalytics) {
        const projectId = presentData.id ?? 'default';
        const sections = presentData.manuscript.map((s, idx) => ({
          id: s.id,
          title: s.title,
          wordCount: (s.content?.match(/\S+/g) ?? []).length,
          status: s.status,
          position: idx,
          // QNBS-v3: P3 — scene_start feeds v_scene_overlap for DuckDB timeline analysis.
          scene_start: s.sceneStart,
        }));
        const totalWordCount = sections.reduce((acc, s) => acc + s.wordCount, 0);
        void duckdbDualWrite(
          projectId,
          presentData.title,
          presentData.logline,
          totalWordCount,
          presentData.projectGoals?.totalWordCount,
          presentData.projectGoals?.targetDate,
          presentData.writingHistory ?? [],
          sections,
        ).catch((err: unknown) => logger.warn('DuckDB dual-write failed (non-critical):', err));
      }

      listenerApi.dispatch(statusActions.setSavingStatus('saved'));
      await listenerApi.delay(2000);
      if ((listenerApi.getState() as RootState).status.saving === 'saved') {
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
      }
    } catch (error) {
      logger.error('Auto-save (project) failed:', error);
      listenerApi.dispatch(
        statusActions.addNotification({
          type: 'error',
          title: 'Auto-Save Failed',
          description: 'Your changes could not be saved to the local database.',
        }),
      );
      listenerApi.dispatch(statusActions.setSavingStatus('idle'));
    }
  },
});

// --- 1b. Auto-Save: Settings ---
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const currentRoot = currentState as RootState;
    const prevRoot = previousState as RootState;
    return currentRoot.settings !== prevRoot.settings;
  },
  effect: async (_action, listenerApi) => {
    const originalState = listenerApi.getOriginalState() as RootState;
    await listenerApi.delay(1000);

    const state = listenerApi.getState() as RootState;
    if (state.settings === originalState.settings) return;

    try {
      await storageService.saveSettings(state.settings);
    } catch (error) {
      logger.error('Auto-save (settings) failed:', error);
    }
  },
});

listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const currentRoot = currentState as RootState;
    const prevRoot = previousState as RootState;

    const currentManuscript = currentRoot.project.present?.data?.manuscript;
    const previousManuscript = prevRoot.project.present?.data?.manuscript;

    return currentManuscript !== previousManuscript;
  },
  effect: async (_action, listenerApi) => {
    await listenerApi.delay(1200);

    const state = listenerApi.getState() as RootState;
    if (!state.featureFlags.enableCodexAutoTracking) return;

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
        {
          advanced: state.featureFlags.enableStoryBibleAdvanced,
        },
        binderResearchSections,
      );
      await saveStoryCodex(codex);

      // QNBS-v3: P3 dual-write — codex entity names/types to DuckDB for co-occurrence queries.
      if ((listenerApi.getState() as RootState).featureFlags.enableDuckDbAnalytics) {
        void duckdbCodexWrite(
          projectId,
          codex.entities.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type,
            mentionCount: e.mentionCount,
            mentions: e.mentions.map((m) => ({ sectionId: m.sectionId, excerpt: m.excerpt })),
          })),
        ).catch((err: unknown) => logger.warn('DuckDB codex write failed (non-critical):', err));
      }
    } catch (error) {
      logger.warn('Story Codex auto-tracking failed:', error);
    }
  },
});

// --- 2. Global Error Handling ---
// Listen for any rejected Async Thunk and show a toast
listenerMiddleware.startListening({
  matcher: isRejected,
  effect: (action, listenerApi) => {
    // Skip if the action was aborted (e.g. cancelled request via AbortController)
    if (action.meta.aborted) return;

    const errorTitle = 'Operation Failed';
    let errorDescription = 'An unexpected error occurred.';

    if (action.error?.message) {
      errorDescription = action.error.message;
    }

    // Specific handling for Gemini API errors if identifiable
    if (errorDescription.includes('quota') || errorDescription.includes('API key')) {
      errorDescription = 'AI Service Error: Please check your API key and quota.';
    }

    listenerApi.dispatch(
      statusActions.addNotification({
        type: 'error',
        title: errorTitle,
        description: errorDescription,
      }),
    );
  },
});

// --- 3. DuckDB Migration Trigger ---
// QNBS-v3: Fires once when DuckDB becomes ready; seeds IDB→DuckDB if marker is absent.
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const curr = currentState as RootState;
    const prev = previousState as RootState;
    return (
      curr.featureFlags.enableDuckDbAnalytics &&
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
      await duckdbMigrateIfNeeded(project);
      listenerApi.dispatch(analyticsActions.setMigrationStatus('done'));
      listenerApi.dispatch(analyticsActions.setLastSyncAt(new Date().toISOString()));
    } catch (err) {
      listenerApi.dispatch(
        analyticsActions.setMigrationError(err instanceof Error ? err.message : String(err)),
      );
    }
  },
});

// Type-safe export
export const startAppListening = listenerMiddleware.startListening as TypedStartListening<
  RootState,
  AppDispatch
>;
