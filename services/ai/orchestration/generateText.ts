import type { AIProvider, AiCreativity } from '../../../types';
import { getOpenRouterFallbackProvider } from '../aiModeService';
import { withTransientRetry } from '../aiRetry';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { applyHeuristicFallback } from '../heuristicFallback';
import { resolveProviderFallbackChain } from '../hybridFallback';
import { throwIfRequestAborted } from '../lifecycle/cancellation';
import { withDeduplicatedRequest } from '../lifecycle/requestDedup';
import { attemptOpenRouterFallback, isOpenRouterTransientFailure } from '../openRouterFallback';
import { recordProviderSuccess, setLastAiFallbackReason } from './fallbackState';
import { generateTextSingleProvider } from './providerDispatch';

async function resolveTerminalTextFallback(
  prompt: string,
  opts: AIRequestOptions,
  chain: AIProvider[],
  lastError: unknown,
): Promise<string> {
  throwIfRequestAborted(undefined, opts.signal);
  const heuristic = applyHeuristicFallback<string>(
    opts.heuristicTask,
    opts.heuristicContext ?? { prompt, reasonKey: 'error.fallback.generic' },
  );
  if (heuristic) {
    setLastAiFallbackReason(
      `All providers in chain failed (${chain.join(' → ')}). Using registered heuristic fallback.`,
    );
    return heuristic.data;
  }
  const { generateLocalText } = await import('../../localAiFacade');
  const local = await generateLocalText(prompt, undefined, undefined, undefined, opts.signal).catch(
    (error) => {
      throwIfRequestAborted(error, opts.signal);
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  );
  throwIfRequestAborted(undefined, opts.signal);
  setLastAiFallbackReason(
    `All providers in chain failed (${chain.join(' → ')}). Using local heuristic fallback.`,
  );
  return local.text;
}

type ProviderAttemptResult =
  | { result: string; attemptedOpenRouterFallback?: string }
  | { lastError: unknown; attemptedOpenRouterFallback?: string };

async function attemptTextProvider(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  provider: AIProvider,
): Promise<ProviderAttemptResult> {
  try {
    const result = await withTransientRetry(
      () => generateTextSingleProvider(prompt, creativity, { ...opts, provider }),
      { attempts: 2 },
    );
    throwIfRequestAborted(undefined, opts.signal);
    return { result };
  } catch (error) {
    throwIfRequestAborted(error, opts.signal);
    const message = error instanceof Error ? error.message : String(error);
    setLastAiFallbackReason(`Provider ${provider} failed: ${message}`);
    if (!isOpenRouterTransientFailure(provider, error)) return { lastError: error };

    const fallback = getOpenRouterFallbackProvider();
    try {
      const result = await attemptOpenRouterFallback(opts, fallback, (fallbackOpts) =>
        withTransientRetry(() => generateTextSingleProvider(prompt, creativity, fallbackOpts), {
          attempts: 2,
        }),
      );
      throwIfRequestAborted(undefined, opts.signal);
      setLastAiFallbackReason(`OpenRouter rate-limited; fell back to ${fallback}.`);
      return { result, attemptedOpenRouterFallback: fallback };
    } catch (fallbackError) {
      throwIfRequestAborted(fallbackError, opts.signal);
      return { lastError: fallbackError, attemptedOpenRouterFallback: fallback };
    }
  }
}

export async function generateText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  return withDeduplicatedRequest(opts, prompt, signal, async (mergedOpts) => {
    const chain = resolveProviderFallbackChain(mergedOpts);
    let lastError: unknown;
    let attemptedOpenRouterFallback: string | undefined;
    for (let i = 0; i < chain.length; i++) {
      const nextProvider = chain[i];
      if (nextProvider === undefined || nextProvider === attemptedOpenRouterFallback) continue;
      const attempt = await attemptTextProvider(prompt, creativity, mergedOpts, nextProvider);
      if ('result' in attempt) {
        recordProviderSuccess(mergedOpts.provider, nextProvider, i);
        return attempt.result;
      }
      lastError = attempt.lastError;
      attemptedOpenRouterFallback = attempt.attemptedOpenRouterFallback;
    }
    return resolveTerminalTextFallback(prompt, mergedOpts, chain, lastError);
  });
}
