import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import { createDeduplicatedThunk } from '../../features/project/aiThunkUtils';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import settingsReducer, { settingsActions } from '../../features/settings/settingsSlice';
import statusReducer from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';
import writerReducer from '../../features/writer/writerSlice';
import { setActiveAiMode } from '../../services/ai/aiModeService';

// QNBS-v3: vi.hoisted() ensures the mock fn is initialized before vi.mock() factory runs,
//          since vi.mock() is hoisted to the top of the file by Vitest's transformer.
const mockAssertCloudAiAllowedSync = vi.hoisted(() => vi.fn());
vi.mock('../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: mockAssertCloudAiAllowedSync,
}));

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
  beforeEach(() => {
    mockAssertCloudAiAllowedSync.mockReset();
  });

  afterEach(() => {
    // QNBS-v3: aiModeService's mode is module-level singleton state — reset it so a test that sets local/eco mode never leaks into a later, unrelated test.
    setActiveAiMode('hybrid');
  });

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

  describe('cloud AI policy enforcement', () => {
    it('calls assertCloudAiAllowedSync with the current provider and privacy settings', async () => {
      const thunk = createDeduplicatedThunk<string>('test/policy-call', async (_arg, api) => {
        api.registerDuplicateRequest('prompt', 'view');
        return 'result';
      });

      const store = makeStore();
      await store.dispatch(thunk());

      // Default settings: advancedAi.provider='gemini', privacy.localStorageOnly=true
      expect(mockAssertCloudAiAllowedSync).toHaveBeenCalledWith(
        'gemini',
        expect.objectContaining({ localStorageOnly: true }),
      );
    });

    it('rejects when cloud AI policy blocks the provider', async () => {
      mockAssertCloudAiAllowedSync.mockImplementation(() => {
        throw new Error('Cloud provider blocked: local-only mode is active.');
      });

      const thunk = createDeduplicatedThunk<string>('test/policy-block', async (_arg, api) => {
        api.registerDuplicateRequest('prompt', 'view');
        return 'should not reach';
      });

      const store = makeStore();
      const result = await store.dispatch(thunk());

      expect(result.type).toBe('test/policy-block/rejected');
      const rejected = result as { error: { message: string } };
      expect(rejected.error.message).toBe('Cloud provider blocked: local-only mode is active.');
    });

    it('resolves the effective (preset-aware) provider, not the global one, when an enabled project preset overrides it', async () => {
      const thunk = createDeduplicatedThunk<string>(
        'test/policy-effective-provider',
        async (_arg, api) => {
          api.registerDuplicateRequest('prompt', 'view');
          return 'result';
        },
      );

      const store = makeStore();
      // QNBS-v3: global provider is local (would short-circuit the policy check trivially if used directly), but an enabled project preset overrides the effective provider to a cloud one — the pre-check must catch this, not the stale global value.
      store.dispatch(settingsActions.setAdvancedAi({ provider: 'ollama' }));
      store.dispatch(projectActions.setProjectAiPreset({ enabled: true, provider: 'gemini' }));

      await store.dispatch(thunk());

      expect(mockAssertCloudAiAllowedSync).toHaveBeenCalledWith(
        'gemini',
        expect.objectContaining({ localStorageOnly: true }),
      );
    });

    it('skips the pre-check when shouldRouteLocally() is true, even with a cloud effective provider, so the safe local-reroute path is not blocked before it runs', async () => {
      const payloadCreator = vi.fn().mockResolvedValue('result');
      const thunk = createDeduplicatedThunk<string>(
        'test/policy-local-routing-skip',
        async (arg, api) => {
          api.registerDuplicateRequest('prompt', 'view');
          return payloadCreator(arg, api);
        },
      );

      const store = makeStore();
      // QNBS-v3: global provider stays the default cloud 'gemini', but local/eco mode means generateText/generateJson will silently reroute to webllm — the pre-check must not reject this before the payload creator (which performs that reroute) even runs.
      setActiveAiMode('local');

      const result = await store.dispatch(thunk());

      expect(result.type).toBe('test/policy-local-routing-skip/fulfilled');
      expect(mockAssertCloudAiAllowedSync).not.toHaveBeenCalled();
      expect(payloadCreator).toHaveBeenCalled();
    });

    it('does not call the payload creator when policy check throws', async () => {
      mockAssertCloudAiAllowedSync.mockImplementation(() => {
        throw new Error('blocked');
      });
      const payloadCreator = vi.fn().mockResolvedValue('result');

      const thunk = createDeduplicatedThunk<string>('test/policy-no-payload', async (arg, api) =>
        payloadCreator(arg, api),
      );

      const store = makeStore();
      await store.dispatch(thunk());

      expect(payloadCreator).not.toHaveBeenCalled();
    });
  });
});
