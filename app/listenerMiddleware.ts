import type { TypedStartListening } from '@reduxjs/toolkit';
import { createListenerMiddleware, isRejected, addListener } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from './store';
import { storageService } from '../services/storageService';
import { statusActions } from '../features/status/statusSlice';
import type { PersistedRootState } from '../types';

export const listenerMiddleware = createListenerMiddleware();

// --- 1. Auto-Save Logic ---
// We listen for *any* action that might change the persistent state.
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const currentRoot = currentState as RootState;
    const prevRoot = previousState as RootState;

    // Check if project.present has changed (ignoring past/future changes to avoid saving on undo/redo steps purely if content is identical)
    // We strictly want to save when content changes.
    const projectChanged = currentRoot.project.present !== prevRoot.project.present;
    const settingsChanged = currentRoot.settings !== prevRoot.settings;

    return projectChanged || settingsChanged;
  },
  effect: async (action, listenerApi) => {
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
      const presentData = state.project.present?.data ?? state.project.data;

      // Validate state before saving — guard against silent corruption
      if (!presentData || presentData.title === undefined) {
        console.error('Auto-save aborted: Invalid project state detected (missing present.data)');
        listenerApi.dispatch(statusActions.setSavingStatus('idle'));
        return;
      }

      const projectDataToSave = { data: presentData };

      // Size warning for large projects
      try {
        const serialized = JSON.stringify(projectDataToSave);
        if (serialized.length > 5 * 1024 * 1024) {
          console.warn(
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
      console.error('Auto-save failed:', error);
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
export const addAppListener = addListener as TypedStartListening<RootState, AppDispatch>;
