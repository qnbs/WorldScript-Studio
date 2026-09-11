/**
 * openRouterFallback.ts
 * ----------------------
 * OpenRouter rate-limit/circuit-open fallback-promotion helpers, shared by generateText and
 * streamText in aiProviderService.ts.
 */
// QNBS-v3: extracted out of aiProviderService.ts (an already-oversized hotspot file) rather than growing it further — the actual per-provider dispatch stays there and is passed in as `attempt`.
import type { AIProvider } from '../../types';
import type { AIRequestOptions } from '../aiProviderService';
import { getActiveAiMode, getLocalFallbackModel } from './aiModeService';
import { logRoutingDecision } from './routingLogger';

// QNBS-v3: identifies a transient OpenRouter failure (rate-limit or open circuit) that should promote to OpenRouter's own configured fallback provider instead of just moving to the next chain entry.
export function isOpenRouterTransientFailure(
  nextProvider: AIProvider | undefined,
  error: unknown,
): boolean {
  if (nextProvider !== 'openrouter') return false;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.startsWith('OPENROUTER_RATE_LIMITED') || msg.startsWith('OPENROUTER_CIRCUIT_OPEN');
}

// QNBS-v3: reusing mergedOpts.model (an OpenRouter model id) would be meaningless for webllm's local registry lookup — gemini's own getModelForText() already defaults safely, so only webllm needs an explicit swap here.
export function buildOpenRouterFallbackOpts(
  mergedOpts: AIRequestOptions,
  fallback: string,
): AIRequestOptions {
  const provider = fallback as AIRequestOptions['provider'];
  if (provider === 'webllm') {
    return { ...mergedOpts, provider, model: getLocalFallbackModel() as AIRequestOptions['model'] };
  }
  return { ...mergedOpts, provider };
}

// QNBS-v3: caller must have already committed `fallback` (e.g. to its own attemptedOpenRouterFallback tracker) before calling, since `attempt` can throw.
export async function attemptOpenRouterFallback<T>(
  mergedOpts: AIRequestOptions,
  fallback: string,
  attempt: (opts: AIRequestOptions) => Promise<T>,
): Promise<T> {
  logRoutingDecision({
    mode: getActiveAiMode(),
    originalProvider: 'openrouter',
    chosenProvider: fallback,
    reason: 'openrouter-fallback',
  });
  return attempt(buildOpenRouterFallbackOpts(mergedOpts, fallback));
}
