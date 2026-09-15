/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import { z } from 'zod';
import type { AIProvider, AiCreativity, GeminiSchema } from '../types';
import {
  getOpenRouterFallbackProvider,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from './ai/aiModeService';
import { assertCloudAiAllowed } from './ai/aiPolicy';
import type { AIRequestOptions, AIStreamCallbacks } from './ai/contracts/providerRequest';
import { testAIConnection } from './ai/discovery/connectionTests';
import {
  listLocalBackendModels,
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
} from './ai/discovery/localModelDiscovery';
import { applyHeuristicFallback } from './ai/heuristicFallback';
import { resolveProviderFallbackChain } from './ai/hybridFallback';
import { throwIfRequestAborted, withMergedAbortSignal } from './ai/lifecycle/cancellation';
import { withDeduplicatedRequest } from './ai/lifecycle/requestDedup';
import { attemptOpenRouterFallback, isOpenRouterTransientFailure } from './ai/openRouterFallback';
import { streamAnthropic } from './ai/providers/anthropicProvider';
import {
  isOpenAiCompatibleLocalPreset,
  streamOpenAiCompatibleLocal,
} from './ai/providers/localOpenAiCompatibleProvider';
import { streamGrok, streamOpenAI } from './ai/providers/openaiProvider';
import { generateOpenRouterText, streamOpenRouter } from './ai/providers/openrouterProvider';
import { attachCause, sanitizePromptValue, stripJsonFences } from './aiUtils';
import {
  generateImage as generateImageGemini,
  generateJson as generateJsonGemini,
  generateText as generateTextGemini,
  streamAiHelpResponse as streamAiHelpResponseGemini,
  streamText as streamTextGemini,
} from './geminiService';
import { generateLocalText } from './localAiFacade';
import { streamOllama } from './ollamaService';
import { storageService } from './storageService';

export type { AIRequestOptions, AIStreamCallbacks } from './ai/contracts/providerRequest';
export type { TestConnectionErrorKind, TestConnectionResult } from './ai/discovery/connectionTests';
export { testAIConnection } from './ai/discovery/connectionTests';
export type {
  LocalEndpointScanResult,
  LocalEndpointScanState,
  LocalServerDiagnostic,
} from './ai/discovery/localModelDiscovery';
export {
  listLocalBackendModels,
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
} from './ai/discovery/localModelDiscovery';
export {
  isAbortError,
  throwIfRequestAborted,
  withMergedAbortSignal,
} from './ai/lifecycle/cancellation';
export { clearPendingRequestsForTest as _clearPendingRequestsForTest } from './ai/lifecycle/requestDedup';

export { GROK_API_ENDPOINT } from './ai/providers/openaiProvider';

const providerTextSchema = z.object({
  text: z.string().min(1),
});

// ─── Fallback reason tracking ────────────────────────────────────────────────
// QNBS-v3: Records why the last fallback occurred so the UI can explain it to the user.
let _lastFallbackReason = '';

export function getLastAiFallbackReason(): string {
  return _lastFallbackReason;
}

export function clearLastAiFallbackReason(): void {
  _lastFallbackReason = '';
}

// ─── Service-level request deduplication ─────────────────────────────────────
// QNBS-v3: prevents duplicate cloud/local calls when components call the service
// directly (complementary to thunk-level dedup in aiThunkUtils).

function recordProviderSuccess(primary: AIProvider, provider: AIProvider, index: number): void {
  _lastFallbackReason =
    index > 0 ? `Primary provider ${primary} failed; fell back to ${provider}.` : '';
}

// QNBS-v3: retain Grok chunk tracking so partial output cannot be followed by fallback text.
function createGrokAttemptCallbacks(
  callbacks: AIStreamCallbacks,
  onChunk: (text: string) => void,
): AIStreamCallbacks {
  return { ...callbacks, onChunk };
}

// ─── Gemini Provider ──────────────────────────────────────────────────────────
// Gemini streaming is handled by the existing geminiService.ts.
// We re-export a compatible interface here.

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

async function streamProvider(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const mergedOpts = withMergedAbortSignal(opts, signal);
  await assertCloudAiAllowed(mergedOpts.provider);
  // QNBS-v3: C-3 LoRA — override model with Ollama adapter tag when set
  const oWithLora: AIRequestOptions =
    mergedOpts.provider === 'ollama' && mergedOpts.loraModelPath
      ? { ...mergedOpts, model: mergedOpts.loraModelPath as typeof mergedOpts.model }
      : mergedOpts;
  switch (oWithLora.provider) {
    case 'openai':
      return streamOpenAI(prompt, oWithLora, callbacks);
    case 'openrouter': {
      // QNBS-v3: OpenRouter streaming — SSE path same as OpenAI.
      const apiKey = await storageService.getApiKey('openrouter');
      if (!apiKey)
        throw new Error(
          'NO_API_KEY: OpenRouter API key missing. Please enter it in Settings → AI → OpenRouter.',
        );
      return streamOpenRouter(prompt, oWithLora, callbacks, apiKey);
    }
    case 'ollama':
      return isOpenAiCompatibleLocalPreset(oWithLora.localBackendPreset)
        ? streamOpenAiCompatibleLocal(prompt, oWithLora, callbacks)
        : streamOllama(prompt, oWithLora, callbacks);
    case 'anthropic':
      return streamAnthropic(prompt, oWithLora, callbacks);
    case 'grok':
      return streamGrok(prompt, oWithLora, callbacks);
    case 'webllm':
    case 'onnx':
    case 'transformers': {
      // QNBS-v3: all local-inference providers share the same facade; modelId selects the layer.
      const merged = oWithLora.systemPrompt?.trim()
        ? `${sanitizePromptValue(oWithLora.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
        : sanitizePromptValue(prompt);
      // QNBS-v3: forward the merged signal so a cancelled/offline-rerouted local stream actually stops instead of running to completion — generateLocalText's 5th param is a real abort hook, not a no-op.
      const local = await generateLocalText(
        merged,
        oWithLora.model,
        undefined,
        undefined,
        oWithLora.signal,
      );
      callbacks.onChunk(local.text);
      callbacks.onDone?.();
      return;
    }
    default:
      return streamTextGemini(
        mergedOpts.systemPrompt
          ? `${sanitizePromptValue(mergedOpts.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
          : prompt,
        creativity,
        callbacks.onChunk,
        mergedOpts.signal,
        mergedOpts.model,
      );
  }
}

async function generateTextSingleProvider(
  prompt: string,
  creativity: AiCreativity,
  o: AIRequestOptions,
): Promise<string> {
  await assertCloudAiAllowed(o.provider);
  switch (o.provider) {
    case 'openai': {
      let result = '';
      await streamOpenAI(prompt, o, {
        onChunk: (text) => {
          result += text;
        },
      });
      return providerTextSchema.parse({ text: result }).text;
    }
    case 'openrouter': {
      // QNBS-v3: OpenRouter — load key at call time (encrypted at rest, never in state).
      const apiKey = await storageService.getApiKey('openrouter');
      if (!apiKey)
        throw new Error(
          'NO_API_KEY: OpenRouter API key missing. Please enter it in Settings → AI → OpenRouter.',
        );
      const text = await generateOpenRouterText(prompt, o, apiKey);
      return providerTextSchema.parse({ text }).text;
    }
    case 'ollama': {
      let result = '';
      const stream = isOpenAiCompatibleLocalPreset(o.localBackendPreset)
        ? streamOpenAiCompatibleLocal
        : streamOllama;
      await stream(prompt, o, {
        onChunk: (text) => {
          result += text;
        },
      });
      return providerTextSchema.parse({ text: result }).text;
    }
    case 'anthropic': {
      // QNBS-v3 (ADR-0016): reuses streamAnthropic, which itself branches on isTauriRuntime
      // (desktop, native) vs. isServerlessProxyCapable (web, via api/claude-proxy).
      let result = '';
      await streamAnthropic(prompt, o, {
        onChunk: (text) => {
          result += text;
        },
      });
      return providerTextSchema.parse({ text: result }).text;
    }
    case 'grok': {
      let result = '';
      await streamGrok(prompt, o, {
        onChunk: (text) => {
          result += text;
        },
      });
      return providerTextSchema.parse({ text: result }).text;
    }
    case 'webllm':
    case 'onnx':
    case 'transformers': {
      // QNBS-v3: pass model to localAiFacade so the correct layer/model is loaded.
      const merged = o.systemPrompt?.trim()
        ? `${sanitizePromptValue(o.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
        : sanitizePromptValue(prompt);
      const local = await generateLocalText(merged, o.model, undefined, undefined, o.signal);
      return providerTextSchema.parse({ text: local.text }).text;
    }
    default: {
      const text = await generateTextGemini(prompt, creativity, o.signal, undefined, o.model);
      return providerTextSchema.parse({ text }).text;
    }
  }
}

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
    _lastFallbackReason = `All providers in chain failed (${chain.join(' → ')}). Using registered heuristic fallback.`;
    return heuristic.data;
  }
  const local = await generateLocalText(prompt, undefined, undefined, undefined, opts.signal).catch(
    (error) => {
      throwIfRequestAborted(error, opts.signal);
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  );
  throwIfRequestAborted(undefined, opts.signal);
  _lastFallbackReason = `All providers in chain failed (${chain.join(' → ')}). Using local heuristic fallback.`;
  return local.text;
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
    // QNBS-v3: tracks an OpenRouter-promoted fallback provider already attempted this call, so the outer loop doesn't invoke it a second time (and double-bill/duplicate) if the chain also lists it later.
    let attemptedOpenRouterFallback: string | undefined;
    for (let i = 0; i < chain.length; i++) {
      const nextProvider = chain[i];
      if (nextProvider === undefined || nextProvider === attemptedOpenRouterFallback) continue;
      try {
        const { withTransientRetry } = await import('./ai/aiRetry');
        const result = await withTransientRetry(
          () =>
            generateTextSingleProvider(prompt, creativity, {
              ...mergedOpts,
              provider: nextProvider,
            }),
          { attempts: 2 },
        );
        throwIfRequestAborted(undefined, mergedOpts.signal);
        // QNBS-v3: Clear fallback reason on success — the chain worked.
        recordProviderSuccess(mergedOpts.provider, nextProvider, i);
        return result;
      } catch (err) {
        throwIfRequestAborted(err, mergedOpts.signal);
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        _lastFallbackReason = `Provider ${nextProvider ?? 'unknown'} failed: ${msg}`;
        // QNBS-v3: OpenRouter rate-limit or circuit-open — log and promote to its configured fallback
        // provider rather than continuing blindly down the chain to avoid masking the root cause.
        if (isOpenRouterTransientFailure(nextProvider, err)) {
          const fallback = getOpenRouterFallbackProvider();
          attemptedOpenRouterFallback = fallback;
          try {
            const result = await attemptOpenRouterFallback(
              mergedOpts,
              fallback,
              async (fallbackOpts) => {
                const { withTransientRetry } = await import('./ai/aiRetry');
                return withTransientRetry(
                  () => generateTextSingleProvider(prompt, creativity, fallbackOpts),
                  { attempts: 2 },
                );
              },
            );
            throwIfRequestAborted(undefined, mergedOpts.signal);
            _lastFallbackReason = `OpenRouter rate-limited; fell back to ${fallback}.`;
            return result;
          } catch (fallbackErr) {
            throwIfRequestAborted(fallbackErr, mergedOpts.signal);
            lastError = fallbackErr;
          }
        }
        if (i === chain.length - 1) break;
      }
    }
    return resolveTerminalTextFallback(prompt, mergedOpts, chain, lastError);
  });
}

// QNBS-v3: shared by generateJson and streamAiHelpResponse so each call site's own branching stays flat for CodeScene's complexity gate on this already-hot file — also excludes OpenRouter-preferred mode so these paths fall through to generateText's own resolvePositiveRoutingOpts-based promotion instead of bypassing it with a direct Gemini SDK call.
function isGeminiDirectCloudPath(provider: AIProvider): boolean {
  return provider === 'gemini' && !shouldRouteLocally() && !shouldUseOpenRouter();
}

// QNBS-v3: direct structured generation shares the same duplicate/caller cancellation fence as text generation.
async function generateDirectGeminiJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<T> {
  return withDeduplicatedRequest(opts, prompt, signal, async (mergedOpts) => {
    try {
      await assertCloudAiAllowed('gemini');
      const result = await generateJsonGemini<T>(
        prompt,
        creativity,
        schema,
        mergedOpts.signal,
        undefined,
        mergedOpts.model,
      );
      throwIfRequestAborted(undefined, mergedOpts.signal);
      return result;
    } catch (error) {
      throwIfRequestAborted(error, mergedOpts.signal);
      throw error;
    }
  });
}

export async function generateJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<T> {
  try {
    if (isGeminiDirectCloudPath(opts.provider)) {
      return await generateDirectGeminiJson(prompt, creativity, schema, opts, signal);
    }

    const raw = await generateText(prompt, creativity, opts, signal);
    const jsonText = stripJsonFences(raw);

    try {
      return JSON.parse(jsonText) as T;
    } catch (parseError) {
      const parseErr = new Error('The AI model response is not valid JSON. Please try again.');
      attachCause(parseErr, parseError);
      throw parseErr;
    }
  } catch (err) {
    // QNBS-v3: structured generators bypass generateText's local fallback chain (Gemini-direct), so
    // this is their only degrade seam. A user cancel is surfaced; otherwise a registered heuristic
    // generator for this task produces schema-shaped data, else the original error propagates.
    throwIfRequestAborted(err, signal, opts.signal);
    const heuristic = applyHeuristicFallback<T>(
      opts.heuristicTask,
      opts.heuristicContext ?? { prompt, reasonKey: 'error.fallback.generic' },
    );
    if (heuristic) return heuristic.data;
    throw err;
  }
}

// QNBS-v3: lookup table instead of a branch chain — every entry besides 'gemini' is unsupported; an unlisted provider (including 'openrouter') fails closed via the same message rather than a silent Gemini fallback.
const IMAGE_GENERATION_UNSUPPORTED_MESSAGE: Partial<Record<AIProvider, string>> = {
  openai: 'OpenAI image generation is currently not available via the browser version.',
  ollama: 'Ollama image generation is currently not supported. Please use Gemini for images.',
  webllm: 'Local inference is text-only: use Gemini for image generation.',
  onnx: 'Local inference is text-only: use Gemini for image generation.',
  transformers: 'Local inference is text-only: use Gemini for image generation.',
  anthropic:
    'Anthropic image generation is not available. Please use Gemini or Ollama for image content.',
};

export async function generateImage(
  prompt: string,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (opts.provider === 'gemini') {
    const mergedOpts = withMergedAbortSignal(opts, signal);
    throwIfRequestAborted(undefined, mergedOpts.signal);
    await assertCloudAiAllowed('gemini');
    return generateImageGemini(prompt, mergedOpts.signal);
  }
  throw new Error(
    IMAGE_GENERATION_UNSUPPORTED_MESSAGE[opts.provider] ??
      'Image generation is not supported for this provider.',
  );
}

export async function streamText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return withDeduplicatedRequest(opts, prompt, signal, async (mergedOpts) => {
    // QNBS-v3: centralize the late-chunk fence at the provider boundary so every adapter respects request supersession.
    const guardedCallbacks: AIStreamCallbacks = {
      ...callbacks,
      onChunk: (text) => {
        if (!mergedOpts.signal?.aborted) callbacks.onChunk(text);
      },
      onDone: () => {
        if (!mergedOpts.signal?.aborted) callbacks.onDone?.();
      },
    };
    const chain = resolveProviderFallbackChain(mergedOpts);
    let lastError: unknown;
    // QNBS-v3: tracks an OpenRouter-promoted fallback provider already attempted this call, so the outer loop doesn't invoke it a second time (and double-bill/duplicate chunks) if the chain also lists it later.
    let attemptedOpenRouterFallback: string | undefined;
    // QNBS-v3: after the chain is exhausted, deliver a registered heuristic result through the stream
    // (onChunk + onDone) instead of erroring — so streaming features (Writer tools) stay useful offline.
    const tryHeuristicStream = (): boolean => {
      const heuristic = applyHeuristicFallback<string>(
        mergedOpts.heuristicTask,
        mergedOpts.heuristicContext ?? { prompt, reasonKey: 'error.fallback.generic' },
      );
      if (!heuristic) return false;
      guardedCallbacks.onChunk(heuristic.data);
      guardedCallbacks.onDone?.();
      return true;
    };
    for (let i = 0; i < chain.length; i++) {
      const nextProvider = chain[i];
      if (nextProvider === undefined || nextProvider === attemptedOpenRouterFallback) continue;
      // QNBS-v3: track partial Grok output before fallback decisions.
      let grokEmitted = false;
      const callbacksForAttempt =
        nextProvider === 'grok'
          ? createGrokAttemptCallbacks(guardedCallbacks, (text) => {
              grokEmitted = true;
              guardedCallbacks.onChunk(text);
            })
          : guardedCallbacks;
      try {
        await streamProvider(
          prompt,
          creativity,
          { ...mergedOpts, provider: nextProvider },
          callbacksForAttempt,
          signal,
        );
        throwIfRequestAborted(undefined, mergedOpts.signal, signal);
        // QNBS-v3: mirrors generateText's fallback-reason bookkeeping — without this, a stale reason from an earlier failed/promoted request would keep showing in GpuMetricsPanel after this request's primary provider succeeds outright.
        recordProviderSuccess(mergedOpts.provider, nextProvider, i);
        return;
      } catch (error) {
        // QNBS-v3: A user-cancelled request is NOT a provider failure. Don't fall back to the next
        // provider and don't fire a terminal onError — surface the cancellation directly so callers
        // run their silent cancel flow instead of an error path.
        throwIfRequestAborted(error, mergedOpts.signal, signal);
        if (nextProvider === 'grok' && grokEmitted) {
          // QNBS-v3: A partial Grok response must terminate rather than append fallback text to a truncated answer.
          const terminal = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(terminal);
          throw terminal;
        }
        lastError = error;
        // QNBS-v3: mirrors generateText's OpenRouter rate-limit/circuit-open promotion — without this, a stream promoted to OpenRouter by resolvePositiveRoutingOpts would fail hard on a transient OpenRouter outage instead of falling back.
        if (isOpenRouterTransientFailure(nextProvider, error)) {
          const fallback = getOpenRouterFallbackProvider();
          attemptedOpenRouterFallback = fallback;
          try {
            await attemptOpenRouterFallback(mergedOpts, fallback, (fallbackOpts) =>
              streamProvider(prompt, creativity, fallbackOpts, guardedCallbacks, signal),
            );
            throwIfRequestAborted(undefined, mergedOpts.signal, signal);
            _lastFallbackReason = `OpenRouter rate-limited; fell back to ${fallback}.`;
            return;
          } catch (fallbackError) {
            // QNBS-v3: mirrors the outer catch's cancellation guard — a cancel during the promoted fallback must not be treated as a provider failure either.
            throwIfRequestAborted(fallbackError, mergedOpts.signal, signal);
            lastError = fallbackError;
          }
        }
        if (i === chain.length - 1) {
          // QNBS-v3: onError is owned by this orchestration layer — fire it exactly once, after
          // the whole fallback chain is exhausted, so a failing provider never surfaces a terminal
          // error callback while a subsequent fallback provider is still about to succeed.
          const terminal = lastError instanceof Error ? lastError : new Error(String(lastError));
          if (tryHeuristicStream()) return;
          callbacks.onError?.(terminal);
          throw terminal;
        }
      }
    }
    const terminal = lastError instanceof Error ? lastError : new Error(String(lastError));
    if (tryHeuristicStream()) return;
    callbacks.onError?.(terminal);
    throw terminal;
  });
}

export async function streamAiHelpResponse(
  question: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  extras?: { docContext?: string },
): Promise<void> {
  const doc = extras?.docContext?.trim();
  const mergedBody = doc
    ? `${doc}\n\n---\n\nUser question:\n${sanitizePromptValue(question)}`
    : sanitizePromptValue(question);
  const helpPromptWithDocs = doc
    ? `You are a helpful assistant for WorldScript Studio. Prefer the documentation excerpts below when they answer the question; otherwise give concise general guidance. Format using Markdown.\n\n${mergedBody}`
    : `You are a helpful assistant for a creative writing app called WorldScript Studio. Answer the user's question concisely and clearly. Format your answer using Markdown. Question: ${sanitizePromptValue(question)}`;
  if (isGeminiDirectCloudPath(opts.provider)) {
    await assertCloudAiAllowed('gemini');
    return streamAiHelpResponseGemini(
      mergedBody,
      callbacks.onChunk,
      opts.temperature ?? 0.7,
      opts.signal,
    );
  }
  // QNBS-v3: Hilfe-Chat nutzt dieselbe Hybrid-Fallback-Kette wie Projekt-Streaming.
  return streamText(helpPromptWithDocs, creativity, opts, callbacks, opts.signal);
}

// QNBS-v3: Namespace object for ProForge agents — bundles standalone exports so agents can use
//           aiProviderService.generateText(...) without importing each function individually.
export const aiProviderService = {
  generateText,
  generateJson,
  generateImage,
  streamText,
  streamAiHelpResponse,
  listOllamaModels,
  listLocalBackendModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
  testAIConnection,
};
