import { useCompletion } from '@ai-sdk/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAppSelector } from '../app/hooks';
import type { RootState } from '../app/store';
import { selectEnableLoraAdapters } from '../features/featureFlags/featureFlagsSlice';
import { selectActiveLoraOllamaTag } from '../features/lora/loraSelectors';
import {
  WORLDSCRIPT_COMPLETION_URL,
  worldScriptCompletionFetch,
} from '../services/ai/worldScriptCompletionFetch';
import { createLogger, newCorrelationId } from '../services/logger';

// QNBS-v3 (Phase 1): one correlation id per AI generation, shared by the request-start log here,
// the fetch-side failure log, and the retry seam — for end-to-end traceability (no PII logged).
const log = createLogger('ai.completion');

export type WorldScriptIncrementalHandler = (fullText: string, delta: string) => void;

export interface UseWorldScriptAIOptions {
  onIncremental: WorldScriptIncrementalHandler;
  onFinish?: (prompt: string, completion: string) => void;
  onError?: (error: Error) => void;
  // QNBS-v3 (CodeAnt): which surface owns this stream ('writer' | 'copilot' | …). Threaded into the
  // request body so token usage is recorded per surface — a Copilot completion must not overwrite
  // the Writer's "last request" badge. Defaults to 'unknown' downstream.
  source?: string;
}

/**
 * Vercel AI SDK (`useCompletion`) + client-side `streamText` for Writer streaming.
 * Redux sync via `onIncremental` / `onFinish` — not written directly into the manuscript (see `services/ai/index.ts`).
 */
export function useWorldScriptAI(options: UseWorldScriptAIOptions) {
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
      ...(options.source !== undefined && { source: options.source }),
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
      options.source,
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
  const correlationIdRef = useRef('');

  const { completion, complete, stop, isLoading, error, setCompletion } = useCompletion({
    api: WORLDSCRIPT_COMPLETION_URL,
    streamProtocol: 'text',
    fetch: worldScriptCompletionFetch,
    body,
    onFinish: (prompt, text) => {
      finishRef.current?.(prompt, text);
    },
    onError: (err) => {
      log
        .withContext({ correlationId: correlationIdRef.current, provider })
        .warn('AI completion request failed');
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
      const correlationId = newCorrelationId('ai');
      correlationIdRef.current = correlationId;
      // QNBS-v3: log lifecycle (no prompt/keys) + propagate the id into the request body so the
      // fetch-side failure log shares it.
      log.withContext({ correlationId, provider }).info('AI completion request started');
      await complete(userPrompt, { body: { correlationId } });
    },
    [complete, setCompletion, provider],
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
