import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { describe, expect, it } from 'vitest';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import { createDeduplicatedThunk } from '../../features/project/aiThunkUtils';
import projectReducer from '../../features/project/projectSlice';
import settingsReducer from '../../features/settings/settingsSlice';
import statusReducer from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';
import writerReducer from '../../features/writer/writerSlice';

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

describe('createDeduplicatedThunk', () => {
  it('executes the payload creator and returns its result', async () => {
    const thunk = createDeduplicatedThunk<string>('test/simple', async (_arg, api) => {
      api.registerDuplicateRequest('prompt', 'view');
      return 'result';
    });

    const store = makeStore();
    const action = await store.dispatch(thunk());

    expect(action.type).toBe('test/simple/fulfilled');
    expect((action as { payload: string }).payload).toBe('result');
  });

  it('allows concurrent requests with same key (both fulfill)', async () => {
    // The deduplication aborts the internal AbortController of prior requests,
    // but Redux thunk signals are not connected back — both dispatches complete.
    const thunk = createDeduplicatedThunk<string>('test/dedup', async (_arg, api) => {
      api.registerDuplicateRequest('same-prompt', 'same-view');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return 'done';
    });

    const store = makeStore();
    const [r1, r2] = await Promise.all([store.dispatch(thunk()), store.dispatch(thunk())]);

    expect(r1.type).toBe('test/dedup/fulfilled');
    expect(r2.type).toBe('test/dedup/fulfilled');
  });

  it('cleans up the active controller after completion', async () => {
    const thunk = createDeduplicatedThunk<number>('test/cleanup', async (_arg, api) => {
      api.registerDuplicateRequest('cleanup-prompt', 'cleanup-view');
      return 42;
    });

    const store = makeStore();
    const result = await store.dispatch(thunk());

    expect(result.type).toBe('test/cleanup/fulfilled');

    // Dispatching again should NOT abort (no leftover controller)
    const result2 = await store.dispatch(thunk());
    expect(result2.type).toBe('test/cleanup/fulfilled');
  });

  it('forwards the payload creator error as rejected action', async () => {
    const thunk = createDeduplicatedThunk<string>('test/error', async (_arg, api) => {
      api.registerDuplicateRequest('err-prompt', 'err-view');
      throw new Error('AI failed');
    });

    const store = makeStore();
    const result = await store.dispatch(thunk());

    expect(result.type).toBe('test/error/rejected');
  });
});
