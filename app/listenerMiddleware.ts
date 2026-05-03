import type { TypedStartListening } from '@reduxjs/toolkit';
import { createListenerMiddleware, isRejected } from '@reduxjs/toolkit';
import type { ProjectData } from '../features/project/projectSlice';
import { statusActions } from '../features/status/statusSlice';
import { extractStoryCodex, saveStoryCodex } from '../services/codexService';
import { logger } from '../services/logger';
import { saveEnvelopeFromProjectData } from '../services/storageBackend';
import { storageService } from '../services/storageService';
import type { Character, World } from '../types';
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
    return currentRoot.project.present !== prevRoot.project.present;
  },
  effect: async (_action, listenerApi) => {
    await listenerApi.delay(1000);

    const state = listenerApi.getState() as RootState;
    const originalState = listenerApi.getOriginalState() as RootState;
    if (state.project.present === originalState.project.present) return;

    listenerApi.dispatch(statusActions.setSavingStatus('saving'));

    try {
      const projectState = state.project as ProjectStateWithHistory;
      const presentData = projectState.present?.data ?? projectState.data;

      if (!presentData || presentData.title === undefined) {
        logger.error('Auto-save aborted: Invalid project state detected (missing present.data)');
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
        return;
      }

      const projectDataToSave = saveEnvelopeFromProjectData(presentData);

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
    await listenerApi.delay(1000);

    const state = listenerApi.getState() as RootState;
    const originalState = listenerApi.getOriginalState() as RootState;
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

// Type-safe export
export const startAppListening = listenerMiddleware.startListening as TypedStartListening<
  RootState,
  AppDispatch
>;
