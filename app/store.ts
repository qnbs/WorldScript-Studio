import type { AnyAction, Middleware } from '@reduxjs/toolkit';
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import projectReducer, {
  importProjectThunk,
  projectActions,
  restoreSnapshotThunk,
} from '../features/project/projectSlice';
import settingsReducer from '../features/settings/settingsSlice';
import statusReducer from '../features/status/statusSlice';
import writerReducer from '../features/writer/writerSlice';
import undoable from 'redux-undo';
import { listenerMiddleware } from './listenerMiddleware';
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
  if (process.env.NODE_ENV !== 'production' && isLoggerEnabled()) {
    console.group((action as AnyAction).type);
    console.log('dispatching', action);
    const result = next(action);
    console.log('next state', store.getState());
    console.groupEnd();
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
});

// A sophisticated higher-order reducer to augment redux-undo's behavior
export const rootReducer = (
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
  return configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as Partial<RootState> | undefined,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Ignore these paths in the state which might have non-serializable data if necessary
          // (Though we aim for full serializability)
          ignoredActions: ['persist/PERSIST'],
        },
      })
        .prepend(listenerMiddleware.middleware)
        .concat(loggerMiddleware),
  });
};

const _tempStore = configureStore({ reducer: rootReducer });
export type RootState = ReturnType<typeof _tempStore.getState>;
export type AppDispatch = typeof _tempStore.dispatch;
