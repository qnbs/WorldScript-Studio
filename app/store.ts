import type { AnyAction, Middleware, Reducer } from '@reduxjs/toolkit';
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import projectReducer, {
  importProjectThunk,
  projectActions,
  restoreSnapshotThunk,
} from '../features/project/projectSlice';
import settingsReducer from '../features/settings/settingsSlice';
import statusReducer from '../features/status/statusSlice';
import writerReducer from '../features/writer/writerSlice';
import featureFlagsReducer, {
  featureFlagsPersistenceMiddleware,
} from '../features/featureFlags/featureFlagsSlice';
import undoable from 'redux-undo';
import { listenerMiddleware } from './listenerMiddleware';
import { logger } from '../services/logger';
import type { PersistedRootState } from '../types';

// A sophisticated filter to prevent async thunk actions from populating the undo history.
const filterUndoableActions = (action: AnyAction) => {
  const isThunkAction = ['/pending', '/fulfilled', '/rejected'].some((suffix) =>
    action.type.endsWith(suffix)
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
  if (process.env['NODE_ENV'] !== 'production' && isLoggerEnabled()) {
    logger.debug('dispatching', action);
    const result = next(action);
    logger.debug('next state', store.getState());
    return result;
  }
  return next(action);
};

import versionControlReducer from '../features/versionControl/versionControlSlice';

const combinedReducer = combineReducers({
  project: undoable(projectReducer, {
    limit: 100,
    filter: filterUndoableActions,
  }),
  settings: settingsReducer,
  status: statusReducer,
  writer: writerReducer,
  versionControl: versionControlReducer,
  featureFlags: featureFlagsReducer,
});

// A sophisticated higher-order reducer to augment redux-undo's behavior
export const rootReducer: Reducer<ReturnType<typeof combinedReducer>, AnyAction> = (
  state: ReturnType<typeof combinedReducer> | undefined,
  action: AnyAction
) => {
  let nextState = state;

  // This cutting-edge technique provides clean undo history on project reset/import/restore
  if (
    action.type === projectActions.resetProject.type ||
    action.type === importProjectThunk.fulfilled.type ||
    action.type === restoreSnapshotThunk.fulfilled.type
  ) {
    if (nextState && nextState.project) {
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

  return combinedReducer(nextState, action);
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
          ignoredActions: ['persist/PERSIST'],
        },
      })
        .prepend(listenerMiddleware.middleware)
        .concat(featureFlagsPersistenceMiddleware, loggerMiddleware),
  };

  if (preloadedState) {
    storeOptions.preloadedState = preloadedState as unknown as ReturnType<typeof combinedReducer>;
  }

  return configureStore(storeOptions);
};

const _tempStore = configureStore({ reducer: rootReducer });
export type RootState = ReturnType<typeof _tempStore.getState>;
export type AppDispatch = typeof _tempStore.dispatch;
