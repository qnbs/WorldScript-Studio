/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import { detectWebGpuSupport } from '@domain/ai-core';
import { z } from 'zod';
import type { AIProvider, AiCreativity, GeminiSchema, LocalBackendPreset } from '../types';
import {
  getOpenRouterFallbackProvider,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from './ai/aiModeService';
import { assertCloudAiAllowed } from './ai/aiPolicy';
// QNBS-v3: connection tests use the same current Anthropic default as the catalog and proxy.
import { DEFAULT_ANTHROPIC_MODEL_ID } from './ai/cloudModelCatalog';
import type { AIRequestOptions, AIStreamCallbacks } from './ai/contracts/providerRequest';
import { applyHeuristicFallback } from './ai/heuristicFallback';
import { resolveProviderFallbackChain } from './ai/hybridFallback';
import { throwIfRequestAborted, withMergedAbortSignal } from './ai/lifecycle/cancellation';
import { withDeduplicatedRequest } from './ai/lifecycle/requestDedup';
import {
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from './ai/modelNormalization';
import { attemptOpenRouterFallback, isOpenRouterTransientFailure } from './ai/openRouterFallback';
import { streamAnthropic } from './ai/providers/anthropicProvider';
import {
  isOpenAiCompatibleLocalPreset,
  streamOpenAiCompatibleLocal,
} from './ai/providers/localOpenAiCompatibleProvider';
import { streamGrok, streamOpenAI } from './ai/providers/openaiProvider';
import { generateOpenRouterText, streamOpenRouter } from './ai/providers/openrouterProvider';
import { attachCause, sanitizePromptValue, stripJsonFences } from './aiUtils';
import { isServerlessProxyCapable } from './deployTarget';
import {
  generateImage as generateImageGemini,
  generateJson as generateJsonGemini,
  generateText as generateTextGemini,
  streamAiHelpResponse as streamAiHelpResponseGemini,
  streamText as streamTextGemini,
} from './geminiService';
import { generateLocalText } from './localAiFacade';
import { LocalServerError, localServerFetch } from './localServerHttp';
import { createLogger } from './logger';
import { assertCspConnectEndpointAllowed, CspConnectPolicyError } from './network/cspOriginPolicy';
import {
  listOllamaModels as listOllamaModelsFromService,
  streamOllama,
  testOllamaConnection,
} from './ollamaService';
import { storageService } from './storageService';
import { isTauriRuntime } from './tauriRuntime';

export type { AIRequestOptions, AIStreamCallbacks } from './ai/contracts/providerRequest';
export {
  isAbortError,
  throwIfRequestAborted,
  withMergedAbortSignal,
} from './ai/lifecycle/cancellation';
export { clearPendingRequestsForTest as _clearPendingRequestsForTest } from './ai/lifecycle/requestDedup';

const log = createLogger('aiProviderService');

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

export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  return listOllamaModelsFromService(baseUrl);
}

/** Safe details from an explicit local-server diagnostic; credentials and response bodies stay local. */
export interface LocalServerDiagnostic {
  normalizedEndpoint: string;
  transport: 'tauri-http' | 'browser-fetch';
  modelNames: string[];
}

function localServerTransport(): LocalServerDiagnostic['transport'] {
  return isTauriRuntime() ? 'tauri-http' : 'browser-fetch';
}

function localServerFailure(
  error: unknown,
  endpoint: string,
): Pick<TestConnectionResult, 'ok' | 'error' | 'kind' | 'params'> {
  if (error instanceof LocalServerError && error.kind === 'plugin_unavailable') {
    return { ok: false, error: 'Desktop HTTP plugin unavailable', kind: 'pluginUnavailable' };
  }
  if (error instanceof LocalServerError && error.kind === 'timeout') {
    return {
      ok: false,
      error: `Local server timed out (${endpoint})`,
      kind: 'timeout',
      params: { url: endpoint },
    };
  }
  if (error instanceof CspConnectPolicyError) {
    return {
      ok: false,
      error: error.message,
      kind: 'policyBlocked',
      params: { url: endpoint },
    };
  }
  return {
    ok: false,
    error: `Local server not reachable (${endpoint})`,
    kind: 'unreachable',
    params: { url: endpoint },
  };
}

/**
 * Tests the standard OpenAI-compatible endpoint used by LM Studio and vLLM. The request is
 * user-triggered by the Settings card; opening Settings remains side-effect free.
 */
export async function testOpenAiCompatibleLocalConnection(
  baseUrl: string | undefined,
): Promise<TestConnectionResult> {
  const normalizedEndpoint = normalizeOpenAiCompatibleBaseUrl(
    baseUrl?.trim() || 'http://localhost:1234',
  );
  try {
    const response = await localServerFetch(`${normalizedEndpoint}/models`, { timeoutMs: 5000 });
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        kind: 'httpError',
        params: { status: response.status },
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: 'Invalid models response', kind: 'invalidResponse' };
    }
    const data =
      typeof payload === 'object' &&
      payload !== null &&
      Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : null;
    if (data === null) {
      return { ok: false, error: 'Invalid models response', kind: 'invalidResponse' };
    }
    const modelNames = data.flatMap((model) => {
      if (typeof model !== 'object' || model === null) return [];
      const id = (model as { id?: unknown }).id;
      return typeof id === 'string' && id.trim() ? [id.trim()] : [];
    });
    if (modelNames.length === 0) {
      return { ok: false, error: 'No models exposed', kind: 'noModels' };
    }
    return {
      ok: true,
      localServer: { normalizedEndpoint, transport: localServerTransport(), modelNames },
    };
  } catch (error) {
    return localServerFailure(error, normalizedEndpoint);
  }
}

/** Loads models for an explicit local-backend choice without assuming every server speaks Ollama. */
export async function listLocalBackendModels(
  baseUrl: string | undefined,
  preset: LocalBackendPreset,
): Promise<string[]> {
  if (!isOpenAiCompatibleLocalPreset(preset)) return listOllamaModels(baseUrl);
  const result = await testOpenAiCompatibleLocalConnection(baseUrl);
  return result.ok ? (result.localServer?.modelNames ?? []) : [];
}

/** QNBS-v3: classified reachability of a scanned local endpoint (#266). */
export type LocalEndpointScanState = 'ok' | 'unreachable' | 'timeout' | 'http';

export interface LocalEndpointScanResult {
  labelKey: string;
  baseUrl: string;
  ok: boolean;
  state: LocalEndpointScanState;
  /** Numeric HTTP status when the server answered (incl. error statuses). */
  status?: number;
}

/**
 * QNBS-v3: Schneller Desktop-Check typischer lokaler /v1-Endpunkte — keine Secrets, nur
 * Erreichbarkeit. #266: routed through localServerFetch (Tauri plugin-http on desktop) so the
 * scan works inside the WebView, with per-endpoint state classification for actionable UI badges.
 * Ollama tries its native /api/tags first (present since early versions) before falling back to
 * the OpenAI-compat /v1/models shim (only on Ollama ≥0.1.24) — mirrors the native-first approach
 * testOllamaConnection/listOllamaModels already use, so an older Ollama install isn't missed.
 */
export async function scanLocalOpenAiCompatibleEndpoints(): Promise<LocalEndpointScanResult[]> {
  const candidates = [
    { labelKey: 'settings.ai.scanLabelOllama', baseUrl: 'http://localhost:11434', ollama: true },
    { labelKey: 'settings.ai.scanLabelLmStudio', baseUrl: 'http://localhost:1234', ollama: false },
    { labelKey: 'settings.ai.scanLabelVllm', baseUrl: 'http://localhost:8000', ollama: false },
  ];
  return Promise.all(
    candidates.map(async ({ labelKey, baseUrl, ollama }): Promise<LocalEndpointScanResult> => {
      try {
        let res: Response;
        if (ollama) {
          try {
            res = await localServerFetch(`${baseUrl}/api/tags`, { timeoutMs: 2800 });
          } catch (nativeErr) {
            if (nativeErr instanceof LocalServerError && nativeErr.kind === 'timeout') {
              throw nativeErr;
            }
            const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
            res = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
          }
        } else {
          const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
          res = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
        }
        const ok = res.ok || res.status === 401;
        return { labelKey, baseUrl, ok, state: ok ? 'ok' : 'http', status: res.status };
      } catch (err) {
        const state: LocalEndpointScanState =
          err instanceof LocalServerError && err.kind === 'timeout' ? 'timeout' : 'unreachable';
        return { labelKey, baseUrl, ok: false, state };
      }
    }),
  );
}

/**
 * Stable, i18n-mappable classification of a connection-test failure across ALL providers. `error`
 * stays a raw/technical string for logs; UI code should prefer `kind` (+ `params` for
 * interpolation) to render a localized message via `settings.ai.testError.*`
 * (`locales/<lang>/settings.json`) — falling back to `error` only when `kind` is absent.
 */
export type TestConnectionErrorKind =
  | 'noApiKey'
  | 'httpError'
  | 'timeout'
  | 'unreachable'
  | 'policyBlocked'
  | 'pluginUnavailable'
  | 'desktopRequired'
  | 'proxyUnavailableStaticHost'
  | 'corsSuspected'
  | 'invalidResponse'
  | 'noModels'
  | 'noWebgpu'
  | 'unknownProvider'
  | 'unexpected';

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  kind?: TestConnectionErrorKind;
  params?: Record<string, string | number>;
  localServer?: LocalServerDiagnostic;
}

export async function testAIConnection(
  provider: AIProvider,
  opts: Partial<AIRequestOptions>,
): Promise<TestConnectionResult> {
  try {
    switch (provider) {
      case 'openai': {
        const apiKey = await storageService.getApiKey('openai');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein OpenAI API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'OpenAI' },
          };
        }
        const root = resolveOpenAiCompatibleRoot(opts.openAiCompatibleBaseUrl);
        // QNBS-v3: connection tests reuse the same endpoint policy as production requests.
        assertCspConnectEndpointAllowed(root, 'OpenAI-compatible endpoint');
        const res = await fetch(`${root}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'ollama': {
        // QNBS-v3 (T0): canonical detection — `__TAURI__` alone was false in the real shell, so the
        // desktop Ollama (localhost) path was unreachable there.
        const isDesktop = isTauriRuntime();
        // QNBS-v3 (ADR-0017): enableBrowserOllama is an explicit, advanced opt-in — the user has
        // separately configured their own Ollama server's OLLAMA_ORIGINS for this exact origin
        // (see AnthropicProviderFields-adjacent Ollama UI in AiProviderCard.tsx). Off by default.
        if (!isDesktop && !opts.browserOllamaEnabled) {
          // QNBS-v3 (ADR-0012): browsers block localhost via CORS/Private Network Access, NOT CSP
          // — this repo's CSP already allowlists localhost (docs/adr/0004). Matches the corrected
          // settings.ai.ollamaDesktopOnlyBody wording from #269; this hard-gate string had drifted.
          return {
            ok: false,
            error:
              'Ollama and local OpenAI-compatible servers are only available in the desktop app. Browsers block direct connections from web pages to localhost (CORS and Private Network Access).',
            kind: 'desktopRequired',
          };
        }
        const result = isOpenAiCompatibleLocalPreset(opts.localBackendPreset)
          ? await testOpenAiCompatibleLocalConnection(opts.ollamaBaseUrl)
          : await testOllamaConnection(opts.ollamaBaseUrl);
        // QNBS-v3 (ADR-0017): the Fetch API gives an identical generic failure for "CORS rejected"
        // and "server genuinely down" — this can only be a heuristic hint when running the opt-in
        // browser path, never a certain diagnosis. Desktop keeps the plain 'unreachable' kind.
        if (!isDesktop && !result.ok && result.kind === 'unreachable') {
          return { ...result, kind: 'corsSuspected' };
        }
        return result;
      }
      case 'anthropic': {
        // QNBS-v3 (ADR-0016): desktop bypasses CORS via localServerFetch's native path (Track A);
        // web relays through api/claude-proxy (Track B) — except GitHub Pages, which can host
        // neither Vercel nor Cloudflare Pages Functions and stays structurally unsupported.
        const isDesktop = isTauriRuntime();
        if (!isDesktop && !isServerlessProxyCapable()) {
          return {
            ok: false,
            error:
              'Claude is not available on this deployment (no serverless proxy on GitHub Pages)',
            kind: 'proxyUnavailableStaticHost',
          };
        }
        const apiKey = await storageService.getApiKey('anthropic');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein Claude API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'Claude' },
          };
        }
        // QNBS-v3: Anthropic has no public /v1/models endpoint — a minimal (max_tokens: 1) real
        // request is the practical connectivity check, mirroring the pattern used for Grok.
        // QNBS-v3 (CodeRabbit): bounded like every sibling connectivity check (testOllamaConnection
        // uses timeoutMs: 5000; openai/grok/gemini use AbortSignal.timeout(8000)) — a stalled
        // native/proxy HTTP call must not hang the Settings test spinner indefinitely.
        const res = isDesktop
          ? await localServerFetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: DEFAULT_ANTHROPIC_MODEL_ID,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
              }),
              timeoutMs: 8000,
            })
          : await fetch('/api/claude-proxy', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                apiKey,
                model: DEFAULT_ANTHROPIC_MODEL_ID,
                maxTokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
              }),
              signal: AbortSignal.timeout(8000),
            });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'grok': {
        const apiKey = await storageService.getApiKey('grok');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein Grok API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'Grok' },
          };
        }
        const res = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'gemini': {
        const geminiKey = await storageService.getGeminiApiKey();
        if (!geminiKey) {
          return {
            ok: false,
            error: 'No Gemini API key set',
            kind: 'noApiKey',
            params: { provider: 'Gemini' },
          };
        }
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `Gemini API: HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'webllm':
        return detectWebGpuSupport()
          ? { ok: true }
          : {
              ok: false,
              error:
                'WebGPU unavailable in this browser — WebLLM needs WebGPU (try Chrome/Edge or enable flags).',
              kind: 'noWebgpu',
            };
      case 'onnx':
        // QNBS-v3: ONNX Runtime Web uses WASM — always available, no GPU required.
        return { ok: true };
      case 'transformers':
        // QNBS-v3: Transformers.js uses WASM/WebGPU — connection test is always ok; model loads on first use.
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown provider', kind: 'unknownProvider' };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // QNBS-v3 (CodeAnt CWE-209): log the raw exception for diagnostics; never interpolate it into
    // the user-facing i18n string, which could otherwise leak internal error detail to the UI.
    log.error('testAIConnection: unexpected failure', { provider, message });
    return {
      ok: false,
      error: message,
      kind: 'unexpected',
    };
  }
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
