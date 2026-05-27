import type { AnyAction, Middleware, Reducer } from '@reduxjs/toolkit';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import featureFlagsReducer, {
  featureFlagsPersistenceMiddleware,
} from '../features/featureFlags/featureFlagsSlice';
import plotBoardReducer, {
  plotBoardPersistenceMiddleware,
} from '../features/plotBoard/plotBoardSlice';
import proForgeReducer from '../features/proForge/proForgeSlice';
import progressTrackerReducer, {
  progressTrackerPersistenceMiddleware,
} from '../features/progressTracker/progressTrackerSlice';
import type { ProjectData } from '../features/project/projectSlice';
import projectReducer, { projectActions } from '../features/project/projectSlice';
import {
  importProjectThunk,
  restoreSnapshotThunk,
} from '../features/project/thunks/projectManagementThunks';
import sceneCommentsReducer, {
  sceneCommentsPersistenceMiddleware,
} from '../features/sceneComments/sceneCommentsSlice';
import settingsReducer from '../features/settings/settingsSlice';
import statusReducer from '../features/status/statusSlice';
import writerReducer from '../features/writer/writerSlice';
import { logger } from '../services/logger';
import type { PersistedRootState } from '../types';
import { aiApi } from './aiApi';
import { listenerMiddleware } from './listenerMiddleware';

// A sophisticated filter to prevent async thunk actions from populating the undo history.
const filterUndoableActions = (action: AnyAction) => {
  const isThunkAction = ['/pending', '/fulfilled', '/rejected'].some((suffix) =>
    action.type.endsWith(suffix),
  );
  // Also filter out ephemeral UI actions if any
  return !isThunkAction;
};

// Custom Lightweight Logger Middleware (Development Only, opt-in via localStorage)
const isLoggerEnabled = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('debugRedux') === 'true';
  } catch {
    return false;
  }
};

const loggerMiddleware: Middleware = (store) => (next) => (action) => {
  if (import.meta.env.DEV && isLoggerEnabled()) {
    logger.debug('dispatching', action);
    const result = next(action);
    logger.debug('next state', store.getState());
    return result;
  }
  return next(action);
};

import analyticsReducer from '../features/analytics/analyticsSlice';
import loraReducer, {
  hydrateLoraState,
  loadPersistedLoraState,
  loraPersistenceMiddleware,
} from '../features/lora/loraSlice';
import mindMapUiReducer, {
  mindMapUiPersistenceMiddleware,
} from '../features/mindMap/mindMapUiSlice';
import versionControlReducer from '../features/versionControl/versionControlSlice';
import voiceReducer from '../features/voice/voiceSlice';

const combinedReducer = combineReducers({
  project: undoable(projectReducer, {
    limit: 100,
    filter: filterUndoableActions,
  }),
  settings: settingsReducer,
  status: statusReducer,
  writer: writerReducer,
  proForge: proForgeReducer,
  versionControl: versionControlReducer,
  featureFlags: featureFlagsReducer,
  // QNBS-v3: plotBoard is viewport/connection state only — not undo-able, persisted to localStorage
  plotBoard: plotBoardReducer,
  // QNBS-v3: progressTracker and sceneComments are ephemeral session + user data, localStorage-backed
  progressTracker: progressTrackerReducer,
  sceneComments: sceneCommentsReducer,
  // QNBS-v3: analytics tracks DuckDB-WASM boot + migration status; ephemeral, not persisted
  analytics: analyticsReducer,
  // QNBS-v3: mindMapUi is ephemeral viewport/draw state for MindMapCanvas; localStorage-backed.
  mindMapUi: mindMapUiReducer,
  // Voice mode state for voice command and control
  voice: voiceReducer,
  // QNBS-v3: lora slice for LoRA fine-tuning module (v2.0-alpha); persisted to localStorage
  lora: loraReducer,
  [aiApi.reducerPath]: aiApi.reducer,
});

// A sophisticated higher-order reducer to augment redux-undo's behavior
export const rootReducer: Reducer<ReturnType<typeof combinedReducer>, AnyAction> = (
  state: ReturnType<typeof combinedReducer> | undefined,
  action: AnyAction,
) => {
  let nextState = state;

  // This cutting-edge technique provides clean undo history on project reset/import/restore
  if (
    action.type === projectActions.resetProject.type ||
    action.type === importProjectThunk.fulfilled.type ||
    action.type === restoreSnapshotThunk.fulfilled.type
  ) {
    if (nextState?.project) {
      const { past: _past, future: _future, ...restOfProject } = nextState.project;
      nextState = {
        ...nextState,
        project: {
          ...restOfProject,
          past: [],
          future: [],
        },
      };
    }
  }

  const reduced = combinedReducer(nextState, action);

  if (action.type === importProjectThunk.fulfilled.type) {
    // QNBS-v3: AnyAction ohne payload-Typ — nach fulfilled casten, damit VC aus Import-Payload gemerged werden kann.
    const payload = (action as unknown as { payload: ProjectData }).payload;
    const pvc = payload.persistedVersionControl;
    if (pvc?.branches?.length) {
      return {
        ...reduced,
        versionControl: {
          ...reduced.versionControl,
          branches: pvc.branches,
          snapshots: pvc.snapshots,
          currentBranchId: pvc.currentBranchId,
        },
      };
    }
  }

  return reduced;
};

// The store is now configured and created in index.tsx after async state loading.
// To support preloadedState, we export a factory function or use this temp store for types.
export const setupStore = (preloadedState?: PersistedRootState) => {
  const storeOptions: Parameters<typeof configureStore>[0] = {
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Ignore these paths in the state which might have non-serializable data if necessary
          // (Though we aim for full serializability)
          ignoredActions: [],
        },
      })
        .prepend(listenerMiddleware.middleware)
        .concat(
          featureFlagsPersistenceMiddleware,
          plotBoardPersistenceMiddleware,
          progressTrackerPersistenceMiddleware,
          sceneCommentsPersistenceMiddleware,
          mindMapUiPersistenceMiddleware,
          loraPersistenceMiddleware,
          loggerMiddleware,
          aiApi.middleware as Middleware,
        ),
  };

  if (preloadedState) {
    storeOptions.preloadedState = preloadedState as unknown as ReturnType<typeof combinedReducer>;
  }

  const store = configureStore(storeOptions);

  // Hydrate LoRA state from localStorage on store creation
  const persistedLora = loadPersistedLoraState();
  if (persistedLora) {
    store.dispatch(hydrateLoraState(persistedLora));
  }

  return store;
};

// Temporary store instance used solely for TypeScript type inference.
// This is the recommended pattern when using a factory function (setupStore).
const _tempStore = configureStore({ reducer: rootReducer });
export type RootState = ReturnType<typeof _tempStore.getState>;
export type AppDispatch = typeof _tempStore.dispatch;

// Global store reference for non-React consumers (e.g., voice service)
export const appStoreRef = {
  current: null as { getState(): RootState; dispatch: AppDispatch } | null,
};
