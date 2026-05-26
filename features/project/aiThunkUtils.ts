import type { AsyncThunkConfig, GetThunkAPI } from '@reduxjs/toolkit';
import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../app/store';
import { assertCloudAiAllowedSync } from '../../services/ai/aiPolicy';
import type { AIProvider, PrivacySettings } from '../../types';

type DeduplicatedThunkAPI = GetThunkAPI<AsyncThunkConfig> & {
  registerDuplicateRequest: (prompt: string, viewType: string) => string;
};

const activeControllers = new Map<string, AbortController>();

// Deduplicates AI requests by prompt and view type.
// When a new request with the same prompt/viewType starts, any previous
// pending request for that same key is aborted to prevent spam and race conditions.
export const createDeduplicatedThunk = <Returned, ThunkArg = void>(
  typePrefix: string,
  payloadCreator: (arg: ThunkArg, thunkAPI: DeduplicatedThunkAPI) => Promise<Returned>,
  options?: Parameters<typeof createAsyncThunk<Returned, ThunkArg>>[2],
) => {
  return createAsyncThunk<Returned, ThunkArg>(
    typePrefix,
    async (arg, thunkAPI) => {
      let activeRequestKey: string | null = null;
      let activeController: AbortController | null = null;

      const registerDuplicateRequest = (prompt: string, viewType: string) => {
        // QNBS-v3: Include preset hash so changing provider/model/temperature aborts stale requests.
        const state = thunkAPI.getState() as RootState;
        const preset = state.project.present?.data?.aiPreset;
        const presetHash =
          preset?.enabled === true
            ? JSON.stringify({ p: preset.provider, m: preset.model, t: preset.temperature })
            : '';
        const baseKey = JSON.stringify({ prompt, viewType, presetHash });
        const uniqueKey = `${baseKey}|${Date.now()}`;

        for (const entry of Array.from(activeControllers.entries())) {
          const [storedKey, controller] = entry;
          if (storedKey.startsWith(`${baseKey}|`)) {
            controller.abort();
            activeControllers.delete(storedKey);
          }
        }

        const controller = new AbortController();
        activeRequestKey = uniqueKey;
        activeController = controller;
        activeControllers.set(uniqueKey, controller);

        thunkAPI.signal.addEventListener(
          'abort',
          () => {
            controller.abort();
          },
          { once: true },
        );

        return uniqueKey;
      };

      const wrappedThunkAPI = {
        ...thunkAPI,
        registerDuplicateRequest,
      } as DeduplicatedThunkAPI;

      try {
        // QNBS-v3: Enforce cloud AI policy before every AI thunk — one place to enforce instead
        //          of relying on each caller to manually call assertCloudAiAllowed().
        const state = thunkAPI.getState() as RootState;
        const provider = (state.settings as unknown as { advancedAi?: { provider?: AIProvider } })
          .advancedAi?.provider;
        if (provider) {
          const privacy = (state.settings as unknown as { privacy?: PrivacySettings }).privacy;
          assertCloudAiAllowedSync(provider, privacy);
        }
        return await payloadCreator(arg, wrappedThunkAPI);
      } finally {
        if (activeRequestKey && activeController) {
          const current = activeControllers.get(activeRequestKey);
          if (current === activeController) {
            activeControllers.delete(activeRequestKey);
          }
        }
      }
    },
    options,
  );
};
