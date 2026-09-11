/**
 * positiveRouting.ts
 * -------------------
 * Positive AI-mode routing (local-only → webllm, else OpenRouter-preferred, else passthrough).
 */
// QNBS-v3: extracted out of aiProviderService.ts so aiThunkUtils.ts's policy pre-check avoids pulling in the whole provider-adapter import graph just to resolve an effective provider.
import type { AIRequestOptions } from '../aiProviderService';
import {
  getActiveAiMode,
  getLocalFallbackModel,
  getOpenRouterModel,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from './aiModeService';
import { logRoutingDecision } from './routingLogger';

// QNBS-v3: on-device providers excluded from the mode override; includes 'ollama' unlike aiConstants.ts's own LOCAL_INFERENCE_PROVIDERS, a separate pre-existing disagreement left as-is here.
const _LOCAL_INFERENCE_PROVIDERS = new Set<string>(['webllm', 'onnx', 'transformers', 'ollama']);

export function resolvePositiveRoutingOpts(opts: AIRequestOptions): AIRequestOptions {
  if (shouldRouteLocally() && !_LOCAL_INFERENCE_PROVIDERS.has(opts.provider)) {
    const localModel = getLocalFallbackModel();
    logRoutingDecision({
      mode: getActiveAiMode(),
      originalProvider: opts.provider,
      chosenProvider: 'webllm',
      reason: 'mode-override',
    });
    return { ...opts, provider: 'webllm', model: localModel as AIRequestOptions['model'] };
  }
  if (
    shouldUseOpenRouter() &&
    !_LOCAL_INFERENCE_PROVIDERS.has(opts.provider) &&
    opts.provider !== 'openrouter'
  ) {
    // QNBS-v3: when enabled and the caller specified a cloud provider other than openrouter, promote to OpenRouter (free-tier or user-configured model).
    const orModel = getOpenRouterModel();
    logRoutingDecision({
      mode: getActiveAiMode(),
      originalProvider: opts.provider,
      chosenProvider: 'openrouter',
      reason: 'openrouter-preferred',
    });
    return { ...opts, provider: 'openrouter', model: orModel as AIRequestOptions['model'] };
  }
  logRoutingDecision({
    mode: getActiveAiMode(),
    originalProvider: opts.provider,
    chosenProvider: opts.provider,
    reason: 'passthrough',
  });
  return opts;
}
