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
import { setActiveAiMode, setOpenRouterConfig } from '../../services/ai/aiModeService';

// QNBS-v3: vi.hoisted() ensures the mock fn is initialized before vi.mock() factory runs,
//          since vi.mock() is hoisted to the top of the file by Vitest's transformer.
const mockAssertCloudAiAllowedSync = vi.hoisted(() => vi.fn());
vi.mock('../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: mockAssertCloudAiAllowedSync,
}));

function makeStore(projectId = 'default', generation = 0) {
  const projectUndoableReducer = undoable(projectReducer, { limit: 100 });
  const initialProjectState = projectUndoableReducer(undefined, { type: '@@test/init' });
  return configureStore({
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
        ...initialProjectState,
        present: {
          ...initialProjectState.present,
          generation,
          data: { ...initialProjectState.present.data, id: projectId },
        },
      },
    },
  });
}

describe('createDeduplicatedThunk', () => {
  beforeEach(() => {
    mockAssertCloudAiAllowedSync.mockReset();
  });

  afterEach(() => {
    // QNBS-v3: aiModeService's mode/OpenRouter state is module-level singleton state — reset it so a test that changes it never leaks into a later, unrelated test.
    setActiveAiMode('hybrid');
    setOpenRouterConfig(false, '');
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

  it('aborts the earlier request with the same key through its returned signal', async () => {
    let firstRequest = true;
    let resolveFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    const thunk = createDeduplicatedThunk<string>('test/dedup', async (_arg, api) => {
      const signal = api.registerDuplicateRequest('same-prompt', 'same-view');
      if (firstRequest) {
        firstRequest = false;
        resolveFirstStarted();
        await new Promise<never>((_resolve, reject) => {
          const rejectIfAborted = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal.aborted) {
            rejectIfAborted();
          } else {
            signal.addEventListener('abort', rejectIfAborted, { once: true });
          }
        });
      }
      return 'done';
    });

    const store = makeStore();
    const firstResult = store.dispatch(thunk());
    await firstStarted;
    const secondResult = store.dispatch(thunk());
    const [r1, r2] = await Promise.all([firstResult, secondResult]);

    expect(r1.type).toBe('test/dedup/rejected');
    expect(r2.type).toBe('test/dedup/fulfilled');
  });

  it('does not abort identical prompts in different project incarnations', async () => {
    let firstRequest = true;
    let firstAborted = false;
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const thunk = createDeduplicatedThunk<string>('test/project-scope', async (_arg, api) => {
      const signal = api.registerDuplicateRequest('same-prompt', 'same-view');
      if (firstRequest) {
        firstRequest = false;
        signal.addEventListener('abort', () => {
          firstAborted = true;
        });
        firstStarted();
        await firstReleased;
      }
      return 'done';
    });

    const firstStore = makeStore('same-project', 0);
    const secondStore = makeStore('same-project', 1);
    const firstResult = firstStore.dispatch(thunk());
    await started;
    const secondResult = await secondStore.dispatch(thunk());
    releaseFirst();
    const firstAction = await firstResult;

    expect(firstAction.type).toBe('test/project-scope/fulfilled');
    expect(secondResult.type).toBe('test/project-scope/fulfilled');
    expect(firstAborted).toBe(false);
  });

  it('does not deduplicate when project identity cannot be resolved', async () => {
    let firstRequest = true;
    let firstAborted = false;
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const thunk = createDeduplicatedThunk<string>('test/unresolved-scope', async (_arg, api) => {
      const signal = api.registerDuplicateRequest('same-prompt', 'same-view');
      if (firstRequest) {
        firstRequest = false;
        signal.addEventListener('abort', () => {
          firstAborted = true;
        });
        firstStarted();
        await firstReleased;
      }
      return 'done';
    });

    const firstStore = makeStore('');
    const secondStore = makeStore('');
    const firstResult = firstStore.dispatch(thunk());
    await started;
    const secondResult = await secondStore.dispatch(thunk());
    releaseFirst();
    const firstAction = await firstResult;

    expect(firstAction.type).toBe('test/unresolved-scope/fulfilled');
    expect(secondResult.type).toBe('test/unresolved-scope/fulfilled');
    expect(firstAborted).toBe(false);
  });

  it('does not abort identical prompts in different entity scopes', async () => {
    let firstRequest = true;
    let firstAborted = false;
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const thunk = createDeduplicatedThunk<string, string>(
      'test/entity-scope',
      async (scope, api) => {
        const signal = api.registerDuplicateRequest('same-prompt', 'same-view', scope);
        if (firstRequest) {
          firstRequest = false;
          signal.addEventListener('abort', () => {
            firstAborted = true;
          });
          firstStarted();
          await firstReleased;
        }
        return scope;
      },
    );

    const store = makeStore('project-a');
    const firstResult = store.dispatch(thunk('entity-a'));
    await started;
    const secondResult = await store.dispatch(thunk('entity-b'));
    releaseFirst();
    const firstAction = await firstResult;

    expect(firstAction.type).toBe('test/entity-scope/fulfilled');
    expect(secondResult.type).toBe('test/entity-scope/fulfilled');
    expect(firstAborted).toBe(false);
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

    it('checks the routing-resolved local provider, not the nominal cloud one, when shouldRouteLocally() is true — so the safe local-reroute path is not blocked before it runs', async () => {
      const payloadCreator = vi.fn().mockResolvedValue('result');
      const thunk = createDeduplicatedThunk<string>(
        'test/policy-local-routing-resolve',
        async (arg, api) => {
          api.registerDuplicateRequest('prompt', 'view');
          return payloadCreator(arg, api);
        },
      );

      const store = makeStore();
      // QNBS-v3: global provider stays the default cloud 'gemini', but local/eco mode means generateText/generateJson will silently reroute to webllm — the pre-check must validate against that same resolved provider, not the stale nominal one.
      setActiveAiMode('local');

      const result = await store.dispatch(thunk());

      expect(result.type).toBe('test/policy-local-routing-resolve/fulfilled');
      expect(mockAssertCloudAiAllowedSync).toHaveBeenCalledWith(
        'webllm',
        expect.objectContaining({ localStorageOnly: true }),
      );
      expect(payloadCreator).toHaveBeenCalled();
    });

    it('checks the OpenRouter-promoted provider, not the EU-residency-restricted preset provider, when OpenRouter is enabled', async () => {
      const payloadCreator = vi.fn().mockResolvedValue('result');
      const thunk = createDeduplicatedThunk<string>(
        'test/policy-openrouter-promotion',
        async (arg, api) => {
          api.registerDuplicateRequest('prompt', 'view');
          return payloadCreator(arg, api);
        },
      );

      const store = makeStore();
      // QNBS-v3: an enabled project preset picks 'openai' (blocked under EU residency), but OpenRouter is enabled and permitted — the real call would be promoted to 'openrouter', so the pre-check must validate that, not the raw preset provider.
      setOpenRouterConfig(true, 'deepseek/deepseek-r1:free');
      store.dispatch(
        settingsActions.setPrivacy({ euDataResidency: true, localStorageOnly: false }),
      );
      store.dispatch(projectActions.setProjectAiPreset({ enabled: true, provider: 'openai' }));

      const result = await store.dispatch(thunk());

      expect(result.type).toBe('test/policy-openrouter-promotion/fulfilled');
      expect(mockAssertCloudAiAllowedSync).toHaveBeenCalledWith(
        'openrouter',
        expect.objectContaining({ euDataResidency: true }),
      );
      expect(payloadCreator).toHaveBeenCalled();
    });

    it('checks the raw provider for image operations instead of applying text-only routing promotion', async () => {
      const payloadCreator = vi.fn().mockResolvedValue('result');
      const thunk = createDeduplicatedThunk<string>(
        'test/policy-image-operation',
        async (arg, api) => {
          api.registerDuplicateRequest('prompt', 'image');
          return payloadCreator(arg, api);
        },
        undefined,
        'image',
      );

      const store = makeStore();
      // QNBS-v3: [image admission uses the raw provider because image support is fail-closed]
      setOpenRouterConfig(true, 'deepseek/deepseek-r1:free');

      const result = await store.dispatch(thunk());

      expect(result.type).toBe('test/policy-image-operation/fulfilled');
      expect(mockAssertCloudAiAllowedSync).toHaveBeenCalledWith(
        'gemini',
        expect.objectContaining({ localStorageOnly: true }),
      );
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
