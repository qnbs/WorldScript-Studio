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
import type { RoutingReason } from './routingLogger';
import { logRoutingDecision } from './routingLogger';

// QNBS-v3: on-device providers excluded from the mode override; includes 'ollama' unlike aiConstants.ts's own LOCAL_INFERENCE_PROVIDERS, a separate pre-existing disagreement left as-is here.
const _LOCAL_INFERENCE_PROVIDERS = new Set<string>(['webllm', 'onnx', 'transformers', 'ollama']);

function shouldRerouteToLocal(opts: AIRequestOptions): boolean {
  if (_LOCAL_INFERENCE_PROVIDERS.has(opts.provider)) return false;
  return shouldRouteLocally();
}

function shouldPromoteToOpenRouter(opts: AIRequestOptions): boolean {
  if (opts.provider === 'openrouter' || _LOCAL_INFERENCE_PROVIDERS.has(opts.provider)) return false;
  return shouldUseOpenRouter();
}

interface RoutingResolution {
  resolvedOpts: AIRequestOptions;
  reason: RoutingReason;
}

// QNBS-v3: pure resolution, no logging — shared by the logging wrapper below and by peekPositiveRoutingProvider, which must not record a routing-decision entry for a probe that may never become a real request.
function computeRoutingResolution(opts: AIRequestOptions): RoutingResolution {
  if (shouldRerouteToLocal(opts)) {
    const localModel = getLocalFallbackModel();
    return {
      resolvedOpts: { ...opts, provider: 'webllm', model: localModel as AIRequestOptions['model'] },
      reason: 'mode-override',
    };
  }
  // QNBS-v3: when enabled and the caller specified a cloud provider other than openrouter, promote to OpenRouter (free-tier or user-configured model).
  if (shouldPromoteToOpenRouter(opts)) {
    const orModel = getOpenRouterModel();
    return {
      resolvedOpts: {
        ...opts,
        provider: 'openrouter',
        model: orModel as AIRequestOptions['model'],
      },
      reason: 'openrouter-preferred',
    };
  }
  return { resolvedOpts: opts, reason: 'passthrough' };
}

export function resolvePositiveRoutingOpts(opts: AIRequestOptions): AIRequestOptions {
  const { resolvedOpts, reason } = computeRoutingResolution(opts);
  logRoutingDecision({
    mode: getActiveAiMode(),
    originalProvider: opts.provider,
    chosenProvider: resolvedOpts.provider,
    reason,
  });
  return resolvedOpts;
}

// QNBS-v3: side-effect-free variant for the thunk policy pre-check — the real call re-resolves (and logs) again when it actually executes, so this must not double-log or record a decision for a request that may never be dispatched with this exact shape (e.g. generateImage, which never calls resolvePositiveRoutingOpts itself).
export function peekPositiveRoutingProvider(opts: AIRequestOptions): AIRequestOptions['provider'] {
  return computeRoutingResolution(opts).resolvedOpts.provider;
}
