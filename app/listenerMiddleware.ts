import type { TypedStartListening } from '@reduxjs/toolkit';
import { createListenerMiddleware, isRejected } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from './store';
import { storageService } from '../services/storageService';
import { saveStoryCodex, extractStoryCodex } from '../services/codexService';
import { statusActions } from '../features/status/statusSlice';
import type { PersistedRootState, Character, World } from '../types';
import type { ProjectData } from '../features/project/projectSlice';
import { logger } from '../services/logger';

type ProjectStateWithHistory = {
  present?: { data?: ProjectData };
  data?: ProjectData;
};

export const listenerMiddleware = createListenerMiddleware();

// --- 1. Auto-Save Logic ---
// We listen for *any* action that might change the persistent state.
listenerMiddleware.startListening({
  predicate: (_action, currentState, previousState) => {
    const currentRoot = currentState as RootState;
    const prevRoot = previousState as RootState;

    // Check if project.present has changed (ignoring past/future changes to avoid saving on undo/redo steps purely if content is identical)
    // We strictly want to save when content changes.
    const projectChanged = currentRoot.project.present !== prevRoot.project.present;
    const settingsChanged = currentRoot.settings !== prevRoot.settings;

    return projectChanged || settingsChanged;
  },
  effect: async (_action, listenerApi) => {
    // Debounce: Wait 1000ms. If another action comes in, this task is cancelled.
    await listenerApi.delay(1000);

    const state = listenerApi.getState() as RootState;

    listenerApi.dispatch(statusActions.setSavingStatus('saving'));

    try {
      const promises = [];

      // CRITICAL FIX:
      // We must NOT save the entire `state.project` which includes `past` and `future` arrays from redux-undo.
      // As the user writes, the history grows massively, causing IndexedDB writes to block the main thread and crash the browser.
      // We only save `state.project.present`. The hydration logic in index.tsx handles re-wrapping it.

      // Check if 'present' exists (it should with redux-undo), otherwise fallback to flat state
      const projectState = state.project as ProjectStateWithHistory;
      const presentData = projectState.present?.data ?? projectState.data;

      // Validate state before saving — guard against silent corruption
      if (!presentData || presentData.title === undefined) {
        logger.error('Auto-save aborted: Invalid project state detected (missing present.data)');
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
        return;
      }

      const projectDataToSave = { data: presentData };

      // Size warning for large projects
      try {
        const serialized = JSON.stringify(projectDataToSave);
        if (serialized.length > 5 * 1024 * 1024) {
          logger.warn(
            `Auto-save: Project size is ${(serialized.length / 1024 / 1024).toFixed(1)} MB. Consider exporting and archiving.`
          );
        }
      } catch {
        /* non-critical — proceed with save */
      }

      // We are saving a structure that matches { data: ProjectData } essentially, stripping history.
      // Casting to PersistedRootState['project'] (which is `PersistedProjectState`) satisfies the service.
      promises.push(
        storageService.saveProject(projectDataToSave as NonNullable<PersistedRootState['project']>)
      );
      promises.push(storageService.saveSettings(state.settings));

      await Promise.all(promises);

      listenerApi.dispatch(statusActions.setSavingStatus('saved'));

      // Reset to idle after a delay
      await listenerApi.delay(2000);
      // Check if status is still 'saved' before clearing (it might have become 'saving' again)
      if ((listenerApi.getState() as RootState).status.saving === 'saved') {
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
      }
    } catch (error) {
      logger.error('Auto-save failed:', error);
      listenerApi.dispatch(
        statusActions.addNotification({
          type: 'error',
          title: 'Auto-Save Failed',
          description: 'Your changes could not be saved to the local database.',
        })
      );
      listenerApi.dispatch(statusActions.setSavingStatus('idle'));
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
    const project = state.project.present?.data;
    if (!project) return;

    const projectId = project.id || 'default';
    const characters = Object.values(project.characters.entities).filter(Boolean) as Character[];
    const worlds = Object.values(project.worlds.entities).filter(Boolean) as World[];

    try {
      const codex = extractStoryCodex(projectId, project.manuscript, characters, worlds);
      await saveStoryCodex(codex);
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

    if (action.error && action.error.message) {
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
      })
    );
  },
});

// Type-safe export
export const startAppListening = listenerMiddleware.startListening as TypedStartListening<
  RootState,
  AppDispatch
>;
