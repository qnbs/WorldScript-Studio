import { configureStore } from '@reduxjs/toolkit';
import undoable, { type StateWithHistory } from 'redux-undo';
import type { RootState } from '../../app/store';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import type { ProjectData } from '../../features/project/projectSlice';
import projectReducer from '../../features/project/projectSlice';
import settingsReducer from '../../features/settings/settingsSlice';
import statusReducer from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';
import writerReducer from '../../features/writer/writerSlice';

// QNBS-v3: Share one realistic Redux fixture so selector tests exercise populated branches without exporting from a test module.
export function buildState(override: Partial<ProjectData> = {}): RootState {
  const data: ProjectData = {
    title: 'Test',
    logline: '',
    characters: charactersAdapter.getInitialState(),
    worlds: worldsAdapter.getInitialState(),
    outline: [],
    manuscript: [],
    projectGoals: { totalWordCount: 50000, targetDate: null },
    writingHistory: [],
    ...override,
  };

  const store = configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      status: statusReducer,
      writer: writerReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
    },
    preloadedState: {
      project: {
        past: [],
        present: { data },
        future: [],
        group: null,
        _latestUnfiltered: { data },
        index: 0,
        limit: 100,
      } as unknown as StateWithHistory<{ data: ProjectData }>,
    },
  });
  return store.getState() as RootState;
}
