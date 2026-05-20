import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { describe, expect, it } from 'vitest';
import type { RootState } from '../../app/store';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import { buildAiCreativity, buildAiOptions } from '../../features/project/thunks/thunkUtils';
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
    expect(opts.model).toBe('gemini-3.5-flash');
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

  it('project preset overrides provider/model/temperature when enabled', () => {
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
      projectActions.patchProjectAiPreset({
        enabled: true,
        provider: 'ollama',
        model: 'ollama/llama3',
        temperature: 0.1,
        maxTokens: 1024,
      }),
    );
    const opts = buildAiOptions(store.getState() as RootState);
    expect(opts.provider).toBe('ollama');
    expect(opts.model).toBe('ollama/llama3');
    expect(opts.temperature).toBe(0.1);
    expect(opts.maxTokens).toBe(1024);
  });

  it('disabled preset does not override global settings', () => {
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
    store.dispatch(projectActions.patchProjectAiPreset({ enabled: false, provider: 'ollama' }));
    const opts = buildAiOptions(store.getState() as RootState);
    // disabled preset → falls back to global gemini default
    expect(opts.provider).toBe('gemini');
  });
});

describe('buildAiCreativity', () => {
  function makeStore() {
    return configureStore({
      reducer: {
        project: undoable(projectReducer, { limit: 100 }),
        settings: settingsReducer,
        status: statusReducer,
        writer: writerReducer,
        versionControl: versionControlReducer,
        featureFlags: featureFlagsReducer,
      },
    });
  }

  it('returns global aiCreativity when no preset', () => {
    const store = makeStore();
    store.dispatch(settingsActions.setAiCreativity('Focused'));
    expect(buildAiCreativity(store.getState() as RootState)).toBe('Focused');
  });

  it('returns preset creativity when preset is enabled', () => {
    const store = makeStore();
    store.dispatch(settingsActions.setAiCreativity('Focused'));
    store.dispatch(
      projectActions.patchProjectAiPreset({ enabled: true, creativity: 'Imaginative' }),
    );
    expect(buildAiCreativity(store.getState() as RootState)).toBe('Imaginative');
  });

  it('falls back to global when preset is disabled', () => {
    const store = makeStore();
    store.dispatch(settingsActions.setAiCreativity('Balanced'));
    store.dispatch(
      projectActions.patchProjectAiPreset({ enabled: false, creativity: 'Imaginative' }),
    );
    expect(buildAiCreativity(store.getState() as RootState)).toBe('Balanced');
  });
});
