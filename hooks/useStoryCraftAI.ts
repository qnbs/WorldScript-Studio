import { useCompletion } from '@ai-sdk/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAppSelector } from '../app/hooks';
import type { RootState } from '../app/store';
import { selectEnableLoraAdapters } from '../features/featureFlags/featureFlagsSlice';
import { selectActiveLoraOllamaTag } from '../features/lora/loraSelectors';
import {
  STORYCRAFT_COMPLETION_URL,
  storyCraftCompletionFetch,
} from '../services/ai/storyCraftCompletionFetch';

export type StoryCraftIncrementalHandler = (fullText: string, delta: string) => void;

export interface UseStoryCraftAIOptions {
  onIncremental: StoryCraftIncrementalHandler;
  onFinish?: (prompt: string, completion: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Vercel AI SDK (`useCompletion`) + Client-seitiges `streamText` für Writer-Streaming.
 * Redux-Sync über `onIncremental` / `onFinish` — nicht direkt ins Manuskript (siehe `services/ai/index.ts`).
 */
export function useStoryCraftAI(options: UseStoryCraftAIOptions) {
  const provider = useAppSelector((s: RootState) => s.settings.advancedAi.provider);
  const model = useAppSelector((s: RootState) => s.settings.advancedAi.model);
  const ollamaBaseUrl = useAppSelector((s: RootState) => s.settings.advancedAi.ollamaBaseUrl);
  const maxTokens = useAppSelector((s: RootState) => s.settings.advancedAi.maxTokens);
  const creativity = useAppSelector((s: RootState) => s.settings.aiCreativity);
  const openAiCompatibleBaseUrl = useAppSelector(
    (s: RootState) => s.settings.advancedAi.openAiCompatibleBaseUrl,
  );
  const openAiSiteUrl = useAppSelector((s: RootState) => s.settings.advancedAi.openAiSiteUrl);
  const openAiSiteTitle = useAppSelector((s: RootState) => s.settings.advancedAi.openAiSiteTitle);
  // QNBS-v3: C-3 LoRA wiring — when enableLoraAdapters is on and an adapter has ollamaModelTag set,
  // pass it as loraModelPath so streamProvider() substitutes it as the Ollama model identifier.
  const enableLoraAdapters = useAppSelector(selectEnableLoraAdapters);
  const activeLoraTag = useAppSelector(selectActiveLoraOllamaTag);
  const loraModelPath = enableLoraAdapters && activeLoraTag ? activeLoraTag : undefined;

  const body = useMemo(
    () => ({
      provider,
      model,
      ollamaBaseUrl,
      maxOutputTokens: maxTokens,
      creativity,
      openAiCompatibleBaseUrl,
      openAiSiteUrl,
      openAiSiteTitle,
      ...(loraModelPath !== undefined && { loraModelPath }),
    }),
    [
      provider,
      model,
      ollamaBaseUrl,
      maxTokens,
      creativity,
      openAiCompatibleBaseUrl,
      openAiSiteUrl,
      openAiSiteTitle,
      loraModelPath,
    ],
  );

  const incrementalRef = useRef(options.onIncremental);
  const finishRef = useRef(options.onFinish);
  const errorRef = useRef(options.onError);

  useEffect(() => {
    incrementalRef.current = options.onIncremental;
    finishRef.current = options.onFinish;
    errorRef.current = options.onError;
  }, [options.onIncremental, options.onFinish, options.onError]);

  const prevLenRef = useRef(0);

  const { completion, complete, stop, isLoading, error, setCompletion } = useCompletion({
    api: STORYCRAFT_COMPLETION_URL,
    streamProtocol: 'text',
    fetch: storyCraftCompletionFetch,
    body,
    onFinish: (prompt, text) => {
      finishRef.current?.(prompt, text);
    },
    onError: (err) => {
      errorRef.current?.(err);
    },
  });

  useEffect(() => {
    if (completion.length < prevLenRef.current) {
      prevLenRef.current = 0;
    }
    if (completion.length > prevLenRef.current) {
      const delta = completion.slice(prevLenRef.current);
      const full = completion;
      prevLenRef.current = completion.length;
      if (delta.length > 0) {
        incrementalRef.current(full, delta);
      }
    }
  }, [completion]);

  const runCompletion = useCallback(
    async (userPrompt: string) => {
      prevLenRef.current = 0;
      setCompletion('');
      await complete(userPrompt);
    },
    [complete, setCompletion],
  );

  return {
    completion,
    runCompletion,
    stop,
    isLoading,
    error,
    setCompletion,
  };
}
