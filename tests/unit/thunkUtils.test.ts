import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { describe, expect, it } from 'vitest';
import type { RootState } from '../../app/store';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import projectReducer from '../../features/project/projectSlice';
import { buildAiOptions } from '../../features/project/thunks/thunkUtils';
import settingsReducer, { settingsActions } from '../../features/settings/settingsSlice';
import statusReducer from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';
import writerReducer from '../../features/writer/writerSlice';

function buildRootState(): RootState {
  const store = configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      status: statusReducer,
      writer: writerReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
    },
  });
  return store.getState() as RootState;
}

describe('buildAiOptions', () => {
  it('returns default AI options from initial state', () => {
    const state = buildRootState();
    const opts = buildAiOptions(state);

    expect(opts.provider).toBe('gemini');
    expect(opts.model).toBe('gemini-2.5-flash');
    expect(opts.temperature).toBe(0.7);
    expect(opts.maxTokens).toBe(4096);
    expect(opts.ollamaBaseUrl).toBe('http://localhost:11434');
  });

  it('reflects updated provider settings', () => {
    const store = configureStore({
      reducer: {
        project: undoable(projectReducer, { limit: 100 }),
        settings: settingsReducer,
        status: statusReducer,
        writer: writerReducer,
        versionControl: versionControlReducer,
        featureFlags: featureFlagsReducer,
      },
    });

    store.dispatch(
      settingsActions.setAdvancedAi({ provider: 'openai', model: 'gpt-4o', temperature: 0.5 }),
    );

    const opts = buildAiOptions(store.getState() as RootState);
    expect(opts.provider).toBe('openai');
    expect(opts.model).toBe('gpt-4o');
    expect(opts.temperature).toBe(0.5);
  });
});
