import type { AIProvider, AiCreativity } from '../../../types';
import { sanitizePromptValue } from '../../aiUtils';
import { streamAiHelpResponse as streamAiHelpResponseGemini } from '../../geminiService';
import { getOpenRouterFallbackProvider } from '../aiModeService';
import type { AIRequestOptions, AIStreamCallbacks } from '../contracts/providerRequest';
import { applyHeuristicFallback } from '../heuristicFallback';
import { resolveProviderFallbackChain } from '../hybridFallback';
import { throwIfRequestAborted } from '../lifecycle/cancellation';
import { withDeduplicatedRequest } from '../lifecycle/requestDedup';
import { attemptOpenRouterFallback, isOpenRouterTransientFailure } from '../openRouterFallback';
import { recordProviderSuccess, setLastAiFallbackReason } from './fallbackState';
import { isGeminiDirectCloudPath, streamProvider } from './providerDispatch';

export interface StreamTextRequest {
  prompt: string;
  creativity: AiCreativity;
  opts: AIRequestOptions;
  callbacks: AIStreamCallbacks;
  signal?: AbortSignal | undefined;
}

export interface StreamAiHelpRequest {
  question: string;
  creativity: AiCreativity;
  opts: AIRequestOptions;
  callbacks: AIStreamCallbacks;
  extras?: { docContext?: string } | undefined;
}

type StreamAttempt =
  | { kind: 'success'; recordProvider?: boolean }
  | { kind: 'failure'; error: unknown; attemptedOpenRouterFallback?: string }
  | { kind: 'terminal'; error: Error };

function createGrokAttemptCallbacks(
  callbacks: AIStreamCallbacks,
  onChunk: (text: string) => void,
): AIStreamCallbacks {
  return { ...callbacks, onChunk };
}

function createGuardedCallbacks(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
): AIStreamCallbacks {
  return {
    ...request.callbacks,
    onChunk: (text) => {
      if (!mergedOpts.signal?.aborted) request.callbacks.onChunk(text);
    },
    onDone: () => {
      if (!mergedOpts.signal?.aborted) request.callbacks.onDone?.();
    },
  };
}

async function attemptProviderStream(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
  provider: AIProvider,
  guardedCallbacks: AIStreamCallbacks,
): Promise<StreamAttempt> {
  let grokEmitted = false;
  const callbacksForAttempt =
    provider === 'grok'
      ? createGrokAttemptCallbacks(guardedCallbacks, (text) => {
          grokEmitted = true;
          guardedCallbacks.onChunk(text);
        })
      : guardedCallbacks;
  try {
    await streamProvider(
      request.prompt,
      request.creativity,
      { ...mergedOpts, provider },
      callbacksForAttempt,
    );
    throwIfRequestAborted(undefined, mergedOpts.signal, request.signal);
    return { kind: 'success', recordProvider: true };
  } catch (error) {
    throwIfRequestAborted(error, mergedOpts.signal, request.signal);
    if (provider === 'grok' && grokEmitted) {
      const terminal = error instanceof Error ? error : new Error(String(error));
      request.callbacks.onError?.(terminal);
      return { kind: 'terminal', error: terminal };
    }
    return { kind: 'failure', error };
  }
}

async function attemptPromotedStream(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
  guardedCallbacks: AIStreamCallbacks,
): Promise<StreamAttempt> {
  const fallback = getOpenRouterFallbackProvider();
  try {
    await attemptOpenRouterFallback(mergedOpts, fallback, (fallbackOpts) =>
      streamProvider(request.prompt, request.creativity, fallbackOpts, guardedCallbacks),
    );
    throwIfRequestAborted(undefined, mergedOpts.signal, request.signal);
    setLastAiFallbackReason(`OpenRouter rate-limited; fell back to ${fallback}.`);
    return { kind: 'success' };
  } catch (error) {
    throwIfRequestAborted(error, mergedOpts.signal, request.signal);
    return { kind: 'failure', error, attemptedOpenRouterFallback: fallback };
  }
}

async function attemptStreamWithFallback(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
  provider: AIProvider,
  guardedCallbacks: AIStreamCallbacks,
): Promise<StreamAttempt> {
  const primary = await attemptProviderStream(request, mergedOpts, provider, guardedCallbacks);
  if (primary.kind !== 'failure' || !isOpenRouterTransientFailure(provider, primary.error)) {
    return primary;
  }
  return attemptPromotedStream(request, mergedOpts, guardedCallbacks);
}

async function runStreamAttempts(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
  chain: AIProvider[],
  guardedCallbacks: AIStreamCallbacks,
): Promise<StreamAttempt> {
  let lastError: unknown;
  let attemptedOpenRouterFallback: string | undefined;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    if (provider === undefined || provider === attemptedOpenRouterFallback) continue;
    const attempt = await attemptStreamWithFallback(
      request,
      mergedOpts,
      provider,
      guardedCallbacks,
    );
    if (attempt.kind === 'success') {
      if (attempt.recordProvider) recordProviderSuccess(mergedOpts.provider, provider, i);
      return attempt;
    }
    if (attempt.kind === 'terminal') return attempt;
    lastError = attempt.error;
    attemptedOpenRouterFallback = attempt.attemptedOpenRouterFallback;
    if (i === chain.length - 1) break;
  }
  return { kind: 'failure', error: lastError };
}

function tryHeuristicStream(
  request: StreamTextRequest,
  mergedOpts: AIRequestOptions,
  guardedCallbacks: AIStreamCallbacks,
): boolean {
  const heuristic = applyHeuristicFallback<string>(
    mergedOpts.heuristicTask,
    mergedOpts.heuristicContext ?? { prompt: request.prompt, reasonKey: 'error.fallback.generic' },
  );
  if (!heuristic) return false;
  guardedCallbacks.onChunk(heuristic.data);
  guardedCallbacks.onDone?.();
  return true;
}

export async function streamText(request: StreamTextRequest): Promise<void> {
  return withDeduplicatedRequest(
    request.opts,
    request.prompt,
    request.signal,
    async (mergedOpts) => {
      const guardedCallbacks = createGuardedCallbacks(request, mergedOpts);
      const chain = resolveProviderFallbackChain(mergedOpts);
      const attempt = await runStreamAttempts(request, mergedOpts, chain, guardedCallbacks);
      if (attempt.kind === 'success') return;
      if (attempt.kind === 'terminal') throw attempt.error;
      if (tryHeuristicStream(request, mergedOpts, guardedCallbacks)) return;
      const terminal =
        attempt.error instanceof Error ? attempt.error : new Error(String(attempt.error));
      request.callbacks.onError?.(terminal);
      throw terminal;
    },
  );
}

export async function streamAiHelpResponse(request: StreamAiHelpRequest): Promise<void> {
  const { question, creativity, opts, callbacks, extras } = request;
  const doc = extras?.docContext?.trim();
  const mergedBody = doc
    ? `${doc}\n\n---\n\nUser question:\n${sanitizePromptValue(question)}`
    : sanitizePromptValue(question);
  const helpPromptWithDocs = doc
    ? `You are a helpful assistant for WorldScript Studio. Prefer the documentation excerpts below when they answer the question; otherwise give concise general guidance. Format using Markdown.\n\n${mergedBody}`
    : `You are a helpful assistant for a creative writing app called WorldScript Studio. Answer the user's question concisely and clearly. Format your answer using Markdown. Question: ${sanitizePromptValue(question)}`;
  if (isGeminiDirectCloudPath(opts.provider)) {
    const { assertCloudAiAllowed } = await import('../aiPolicy');
    await assertCloudAiAllowed('gemini');
    return streamAiHelpResponseGemini(
      mergedBody,
      callbacks.onChunk,
      opts.temperature ?? 0.7,
      opts.signal,
    );
  }
  return streamText({
    prompt: helpPromptWithDocs,
    creativity,
    opts,
    callbacks,
    signal: opts.signal,
  });
}
