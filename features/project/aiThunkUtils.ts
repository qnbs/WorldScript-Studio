import type { AsyncThunkConfig, GetThunkAPI } from '@reduxjs/toolkit';
import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../app/store';
import { assertCloudAiAllowedSync } from '../../services/ai/aiPolicy';
import {
  type AIRoutingOperation,
  peekPositiveRoutingProvider,
} from '../../services/ai/positiveRouting';
import type { PrivacySettings } from '../../types';
import { getProjectTargetIdentity } from './projectIdentity';
import { buildAiOptions } from './thunks/thunkUtils';

type DeduplicatedThunkAPI = GetThunkAPI<AsyncThunkConfig> & {
  registerDuplicateRequest: (prompt: string, viewType: string, scopeKey?: string) => AbortSignal;
};

const activeControllers = new Map<string, AbortController>();

// QNBS-v3: reject an aborted request at the final storage boundary, not only before an async provider call.
export function assertAiRequestActive(signal: AbortSignal): undefined {
  if (signal.aborted) {
    throw new DOMException('AI request aborted', 'AbortError');
  }
  return undefined;
}

// Deduplicates AI requests by prompt and view type.
// When a new request with the same prompt/viewType starts, any previous
// pending request for that same key is aborted to prevent spam and race conditions.
export const createDeduplicatedThunk = <Returned, ThunkArg = void>(
  typePrefix: string,
  payloadCreator: (arg: ThunkArg, thunkAPI: DeduplicatedThunkAPI) => Promise<Returned>,
  options?: Parameters<typeof createAsyncThunk<Returned, ThunkArg>>[2],
  operation: AIRoutingOperation = 'text',
) => {
  return createAsyncThunk<Returned, ThunkArg>(
    typePrefix,
    async (arg, thunkAPI) => {
      let activeRequestKey: string | null = null;
      let activeController: AbortController | null = null;
      let activeRequestCleanup = () => {};

      const registerDuplicateRequest = (prompt: string, viewType: string, scopeKey?: string) => {
        // QNBS-v3: Include preset hash so changing provider/model/temperature aborts stale requests.
        const state = thunkAPI.getState() as RootState;
        const preset = state.project.present?.data?.aiPreset;
        const presetHash =
          preset?.enabled === true
            ? JSON.stringify({ p: preset.provider, m: preset.model, t: preset.temperature })
            : '';
        // QNBS-v3: identical prompts in separate project incarnations or entities must not abort each other.
        const projectIdentity = getProjectTargetIdentity(state.project.present);
        const baseKey = JSON.stringify({ prompt, viewType, presetHash, projectIdentity, scopeKey });
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

        const abortFromThunk = () => controller.abort();
        if (thunkAPI.signal.aborted) {
          controller.abort();
        } else {
          thunkAPI.signal.addEventListener('abort', abortFromThunk, { once: true });
          activeRequestCleanup = () => {
            thunkAPI.signal.removeEventListener('abort', abortFromThunk);
          };
        }

        // QNBS-v3: return the controller-backed signal so duplicate cancellation reaches provider fetch/worker code; thunkAPI.signal only covers caller aborts.
        return controller.signal;
      };

      const wrappedThunkAPI = {
        ...thunkAPI,
        registerDuplicateRequest,
      } as DeduplicatedThunkAPI;

      try {
        // QNBS-v3: checks the provider the requested operation actually dispatches to, not a
        // generic text-routing prediction applied to every AI capability.
        const state = thunkAPI.getState() as RootState;
        const provider = peekPositiveRoutingProvider(buildAiOptions(state), operation);
        if (provider) {
          const privacy = (state.settings as unknown as { privacy?: PrivacySettings }).privacy;
          assertCloudAiAllowedSync(provider, privacy);
        }
        return await payloadCreator(arg, wrappedThunkAPI);
      } finally {
        activeRequestCleanup();
        activeRequestCleanup = () => {};
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
