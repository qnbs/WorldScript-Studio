import type { AsyncThunkConfig, GetThunkAPI } from '@reduxjs/toolkit';
import { createAsyncThunk } from '@reduxjs/toolkit';

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
        const baseKey = JSON.stringify({ prompt, viewType });
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

export const buildDeduplicationKey = (prompt: string, viewType: string): string =>
  `${prompt}|${viewType}|${Date.now()}`;
