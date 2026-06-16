/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import { detectWebGpuSupport } from '@domain/ai-core';
import { z } from 'zod';
import type { AIProvider, AiCreativity, AiModel, GeminiSchema } from '../types';
import {
  getActiveAiMode,
  getLocalFallbackModel,
  getOpenRouterFallbackProvider,
  getOpenRouterModel,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from './ai/aiModeService';
import { assertCloudAiAllowed } from './ai/aiPolicy';
import { resolveProviderFallbackChain } from './ai/hybridFallback';
import {
  buildOpenRouterStyleHeaders,
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from './ai/modelNormalization';
import { generateOpenRouterText, streamOpenRouter } from './ai/providers/openrouterProvider';
import { logRoutingDecision } from './ai/routingLogger';
import { attachCause, sanitizePromptValue, stripJsonFences } from './aiUtils';
import {
  generateImage as generateImageGemini,
  generateJson as generateJsonGemini,
  generateText as generateTextGemini,
  streamAiHelpResponse as streamAiHelpResponseGemini,
  streamText as streamTextGemini,
} from './geminiService';
import { generateLocalText } from './localAiFacade';
import {
  listOllamaModels as listOllamaModelsFromService,
  streamOllama,
  testOllamaConnection,
} from './ollamaService';
import { storageService } from './storageService';

const providerTextSchema = z.object({
  text: z.string().min(1),
});

export interface AIRequestOptions {
  model: AiModel;
  provider: AIProvider;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  ollamaBaseUrl?: string;
  fallbackProviders?: AIProvider[];
  /** Leer = api.openai.com; sonst OpenRouter/Groq/OpenAI-kompatible Root-URL. */
  openAiCompatibleBaseUrl?: string;
  openAiSiteUrl?: string;
  openAiSiteTitle?: string;
  hybridFallbackEnabled?: boolean;
  hybridFallbackChain?: AIProvider[];
  // QNBS-v3: C-3 LoRA wiring — when set and provider is 'ollama', this tag overrides opts.model.
  // Tag must be created via `ollama create <tag> -f Modelfile` with the adapter baked in.
  loraModelPath?: string;
}

export interface AIStreamCallbacks {
  onChunk: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

function withMergedAbortSignal(opts: AIRequestOptions, signal?: AbortSignal): AIRequestOptions {
  // QNBS-v3: Standalone AbortSignal from callers now reaches OpenAI/Ollama (parity with Gemini streaming / cancellation).
  if (signal === undefined) return opts;
  if (opts.signal === signal) return opts;
  return { ...opts, signal };
}

// QNBS-v3: True for a user/abort-signal cancellation, regardless of how the provider surfaced it
// (DOMException or a plain Error named 'AbortError'). Used to treat cancels as a silent stop, not
// a provider failure that would trigger fallback + a terminal onError callback.
function isAbortError(error: unknown): boolean {
  // QNBS-v3: Match both Error and DOMException named 'AbortError' (DOMException is not always an
  // instanceof Error across runtimes), so a thrown abort is recognized regardless of its class.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

// QNBS-v3: Providers that run on-device — excluded from cloud-policy gate and ai-mode override.
const _LOCAL_INFERENCE_PROVIDERS = new Set<string>(['webllm', 'onnx', 'transformers', 'ollama']);

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

const _pendingRequests = new Map<string, AbortController>();

function _pendingKey(provider: AIProvider, model: AiModel, prompt: string): string {
  return `${provider}:${model}:${prompt.slice(0, 128)}`;
}

/** @internal Only for test isolation — clears in-flight dedup state between tests. */
export function _clearPendingRequestsForTest(): void {
  _pendingRequests.clear();
}

function _deduplicateRequest(
  provider: AIProvider,
  model: AiModel,
  prompt: string,
): { key: string; controller: AbortController } {
  const key = _pendingKey(provider, model, prompt);
  const existing = _pendingRequests.get(key);
  if (existing) {
    existing.abort();
    _pendingRequests.delete(key);
  }
  const controller = new AbortController();
  _pendingRequests.set(key, controller);
  return { key, controller };
}

function _cleanupPendingRequest(key: string, controller: AbortController): void {
  if (_pendingRequests.get(key) === controller) {
    _pendingRequests.delete(key);
  }
}

// ─── Gemini Provider ──────────────────────────────────────────────────────────
// Gemini streaming is handled by the existing geminiService.ts.
// We re-export a compatible interface here.

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

async function streamOpenAI(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const apiKey = await storageService.getApiKey('openai');
  if (!apiKey) throw new Error('NO_API_KEY: OpenAI API key missing. Please enter it in Settings.');

  const usesOfficialOpenAi = !opts.openAiCompatibleBaseUrl?.trim();
  // QNBS-v3: Allow gpt-, o1-, o3-, o4- prefixes; o-series reasoning models ship alongside GPT-4.1.
  const isValidOpenAiModel = opts.model.startsWith('gpt-') || /^o\d/.test(opts.model);
  if (usesOfficialOpenAi && !isValidOpenAiModel) {
    throw new Error(
      `OpenAI: Model "${opts.model}" is not a valid OpenAI model. Please select a GPT or o-series model (e.g. gpt-4.1, o3, o4-mini) in Settings.`,
    );
  }
  const model = opts.model;
  const messages = opts.systemPrompt
    ? [
        { role: 'system', content: sanitizePromptValue(opts.systemPrompt) },
        { role: 'user', content: sanitizePromptValue(prompt) },
      ]
    : [{ role: 'user', content: sanitizePromptValue(prompt) }];

  const apiRoot = resolveOpenAiCompatibleRoot(opts.openAiCompatibleBaseUrl);
  const refererHeaders = buildOpenRouterStyleHeaders(opts.openAiSiteUrl, opts.openAiSiteTitle);
  const res = await fetch(`${apiRoot}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(refererHeaders ?? {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: opts.signal ?? null,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `OpenAI API Error ${res.status}: ${(err as { error?: { message?: string } })?.error?.message ?? res.statusText}`,
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('OpenAI: No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (opts.signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const json = JSON.parse(line.slice(6));
        const delta = json?.choices?.[0]?.delta?.content ?? '';
        if (delta) callbacks.onChunk(delta);
      } catch {
        // malformed chunk – skip
      }
    }
  }

  callbacks.onDone?.();
}

async function streamAnthropic(
  _prompt: string,
  _opts: AIRequestOptions,
  _callbacks: AIStreamCallbacks,
): Promise<void> {
  throw new Error(
    'Claude/Anthropic: Direct browser requests are blocked by Anthropic (CORS). ' +
      'Please use a backend proxy or switch to Gemini/OpenAI/Ollama.',
  );
}

async function streamGrok(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const apiKey = await storageService.getApiKey('grok');
  if (!apiKey) throw new Error('NO_API_KEY: Grok API key missing. Please enter it in Settings.');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      messages: [{ role: 'user', content: sanitizePromptValue(prompt) }],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: opts.signal ?? null,
  });
  if (!res.ok) throw new Error(`Grok API Error ${res.status}: ${res.statusText}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? '';
  if (text) callbacks.onChunk(text);
  callbacks.onDone?.();
}

async function streamProvider(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const o = withMergedAbortSignal(opts, signal);
  await assertCloudAiAllowed(o.provider);
  // QNBS-v3: C-3 LoRA — override model with Ollama adapter tag when set
  const oWithLora: AIRequestOptions =
    o.provider === 'ollama' && o.loraModelPath
      ? { ...o, model: o.loraModelPath as typeof o.model }
      : o;
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
      return streamOllama(prompt, oWithLora, callbacks);
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
      const local = await generateLocalText(merged, oWithLora.model);
      callbacks.onChunk(local.text);
      callbacks.onDone?.();
      return;
    }
    default:
      return streamTextGemini(
        o.systemPrompt
          ? `${sanitizePromptValue(o.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
          : prompt,
        creativity,
        callbacks.onChunk,
        o.signal,
        o.model,
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
      await streamOllama(prompt, o, {
        onChunk: (text) => {
          result += text;
        },
      });
      return providerTextSchema.parse({ text: result }).text;
    }
    case 'anthropic':
      throw new Error(
        'Claude/Anthropic is currently not available in the browser. Please use Gemini, OpenAI or Ollama.',
      );
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
      const local = await generateLocalText(merged, o.model);
      return providerTextSchema.parse({ text: local.text }).text;
    }
    default: {
      const text = await generateTextGemini(prompt, creativity, o.signal, undefined, o.model);
      return providerTextSchema.parse({ text }).text;
    }
  }
}

export async function generateText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  // QNBS-v3: Positive routing — apply AI execution mode overrides before dedup keying (G2).
  // Priority: (1) local-only modes → webllm; (2) OpenRouter enabled → prefer OR for cloud calls;
  // (3) passthrough — use whatever provider the caller specified.
  let resolvedOpts = opts;
  if (shouldRouteLocally() && !_LOCAL_INFERENCE_PROVIDERS.has(opts.provider)) {
    const localModel = getLocalFallbackModel();
    logRoutingDecision({
      mode: getActiveAiMode(),
      originalProvider: opts.provider,
      chosenProvider: 'webllm',
      reason: 'mode-override',
    });
    resolvedOpts = { ...opts, provider: 'webllm', model: localModel as AIRequestOptions['model'] };
  } else if (
    shouldUseOpenRouter() &&
    !_LOCAL_INFERENCE_PROVIDERS.has(opts.provider) &&
    opts.provider !== 'openrouter'
  ) {
    // QNBS-v3: OpenRouter routing — when enabled and caller specified a cloud provider other than
    // openrouter, promote to OpenRouter (free-tier or user-configured model).
    const orModel = getOpenRouterModel();
    logRoutingDecision({
      mode: getActiveAiMode(),
      originalProvider: opts.provider,
      chosenProvider: 'openrouter',
      reason: 'openrouter-preferred',
    });
    resolvedOpts = { ...opts, provider: 'openrouter', model: orModel as AIRequestOptions['model'] };
  } else {
    logRoutingDecision({
      mode: getActiveAiMode(),
      originalProvider: opts.provider,
      chosenProvider: opts.provider,
      reason: 'passthrough',
    });
  }
  const { key, controller } = _deduplicateRequest(
    resolvedOpts.provider,
    resolvedOpts.model,
    prompt,
  );
  const o = withMergedAbortSignal(resolvedOpts, signal ?? controller.signal);
  const chain = resolveProviderFallbackChain(o);
  let lastError: unknown;
  try {
    for (let i = 0; i < chain.length; i++) {
      const nextProvider = chain[i];
      if (nextProvider === undefined) continue;
      try {
        const { withTransientRetry } = await import('./ai/aiRetry');
        const result = await withTransientRetry(
          () =>
            generateTextSingleProvider(prompt, creativity, {
              ...o,
              provider: nextProvider,
            }),
          { attempts: 2 },
        );
        // QNBS-v3: Clear fallback reason on success — the chain worked.
        if (i > 0) {
          _lastFallbackReason = `Primary provider ${o.provider} failed; fell back to ${nextProvider}.`;
        } else {
          _lastFallbackReason = '';
        }
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        _lastFallbackReason = `Provider ${nextProvider ?? 'unknown'} failed: ${msg}`;
        // QNBS-v3: OpenRouter rate-limit or circuit-open — log and promote to its configured fallback
        // provider rather than continuing blindly down the chain to avoid masking the root cause.
        if (
          nextProvider === 'openrouter' &&
          (msg.startsWith('OPENROUTER_RATE_LIMITED') || msg.startsWith('OPENROUTER_CIRCUIT_OPEN'))
        ) {
          const fallback = getOpenRouterFallbackProvider();
          logRoutingDecision({
            mode: getActiveAiMode(),
            originalProvider: 'openrouter',
            chosenProvider: fallback,
            reason: 'openrouter-fallback',
          });
          try {
            const { withTransientRetry } = await import('./ai/aiRetry');
            const result = await withTransientRetry(
              () =>
                generateTextSingleProvider(prompt, creativity, {
                  ...o,
                  provider: fallback as AIRequestOptions['provider'],
                }),
              { attempts: 2 },
            );
            _lastFallbackReason = `OpenRouter rate-limited; fell back to ${fallback}.`;
            return result;
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        }
        if (i === chain.length - 1) break;
      }
    }
    try {
      const local = await generateLocalText(prompt);
      _lastFallbackReason = `All providers in chain failed (${chain.join(' → ')}). Using local heuristic fallback.`;
      return providerTextSchema.parse({ text: local.text }).text;
    } catch {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  } finally {
    _cleanupPendingRequest(key, controller);
  }
}

export async function generateJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<T> {
  if (opts.provider === 'gemini') {
    return generateJsonGemini(prompt, creativity, schema, signal, undefined, opts.model);
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
}

export async function generateImage(
  prompt: string,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  switch (opts.provider) {
    case 'gemini':
      return generateImageGemini(prompt, signal);
    case 'openai':
      throw new Error(
        'OpenAI image generation is currently not available via the browser version.',
      );
    case 'ollama':
      throw new Error(
        'Ollama image generation is currently not supported. Please use Gemini for images.',
      );
    case 'webllm':
    case 'onnx':
    case 'transformers':
      throw new Error('Local inference is text-only: use Gemini for image generation.');
    case 'anthropic':
      throw new Error(
        'Anthropic image generation is not available. Please use Gemini or Ollama for image content.',
      );
    default:
      return generateImageGemini(prompt, signal);
  }
}

export async function streamText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { key, controller } = _deduplicateRequest(opts.provider, opts.model, prompt);
  const o = withMergedAbortSignal(opts, signal ?? controller.signal);
  const chain = resolveProviderFallbackChain(o);
  let lastError: unknown;
  try {
    for (let i = 0; i < chain.length; i++) {
      const nextProvider = chain[i];
      if (nextProvider === undefined) continue;
      try {
        await streamProvider(
          prompt,
          creativity,
          { ...o, provider: nextProvider },
          callbacks,
          signal,
        );
        return;
      } catch (error) {
        // QNBS-v3: A user-cancelled request is NOT a provider failure. Don't fall back to the next
        // provider and don't fire a terminal onError — surface the cancellation directly so callers
        // run their silent cancel flow instead of an error path.
        if (isAbortError(error) || o.signal?.aborted || signal?.aborted) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        lastError = error;
        if (i === chain.length - 1) {
          // QNBS-v3: onError is owned by this orchestration layer — fire it exactly once, after
          // the whole fallback chain is exhausted, so a failing provider never surfaces a terminal
          // error callback while a subsequent fallback provider is still about to succeed.
          const terminal = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(terminal);
          throw terminal;
        }
      }
    }
    const terminal = lastError instanceof Error ? lastError : new Error(String(lastError));
    callbacks.onError?.(terminal);
    throw terminal;
  } finally {
    _cleanupPendingRequest(key, controller);
  }
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
  if (opts.provider === 'gemini') {
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

/** QNBS-v3: Schneller Desktop-Check typischer lokaler /v1-Endpunkte — keine Secrets, nur Erreichbarkeit. */
export async function scanLocalOpenAiCompatibleEndpoints(): Promise<
  { labelKey: string; baseUrl: string; ok: boolean; status?: number }[]
> {
  const candidates = [
    { labelKey: 'settings.ai.scanLabelOllama', baseUrl: 'http://localhost:11434' },
    { labelKey: 'settings.ai.scanLabelLmStudio', baseUrl: 'http://localhost:1234' },
    { labelKey: 'settings.ai.scanLabelVllm', baseUrl: 'http://localhost:8000' },
  ];
  return Promise.all(
    candidates.map(async ({ labelKey, baseUrl }) => {
      try {
        const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
        const res = await fetch(`${root}/models`, { signal: AbortSignal.timeout(2800) });
        const ok = res.ok || res.status === 401;
        return { labelKey, baseUrl, ok, status: res.status };
      } catch {
        return { labelKey, baseUrl, ok: false };
      }
    }),
  );
}

export async function testAIConnection(
  provider: AIProvider,
  opts: Partial<AIRequestOptions>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const apiKey = await storageService.getApiKey('openai');
        if (!apiKey) return { ok: false, error: 'Kein OpenAI API Key gesetzt' };
        const root = resolveOpenAiCompatibleRoot(opts.openAiCompatibleBaseUrl);
        const res = await fetch(`${root}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }
      case 'ollama': {
        const isDesktop = typeof window !== 'undefined' && Boolean(window.__TAURI__);
        if (!isDesktop) {
          return {
            ok: false,
            error:
              'Ollama is only available in the desktop app. The browser Content Security Policy blocks direct connections to localhost.',
          };
        }
        return testOllamaConnection(opts.ollamaBaseUrl);
      }
      case 'anthropic':
        return {
          ok: false,
          error: 'Claude requires a backend proxy (CORS restriction)',
        };
      case 'grok': {
        const apiKey = await storageService.getApiKey('grok');
        if (!apiKey) return { ok: false, error: 'Kein Grok API Key gesetzt' };
        const res = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }
      case 'gemini': {
        const geminiKey = await storageService.getGeminiApiKey();
        if (!geminiKey) return { ok: false, error: 'No Gemini API key set' };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) return { ok: false, error: `Gemini API: HTTP ${res.status}` };
        return { ok: true };
      }
      case 'webllm':
        return detectWebGpuSupport()
          ? { ok: true }
          : {
              ok: false,
              error:
                'WebGPU unavailable in this browser — WebLLM needs WebGPU (try Chrome/Edge or enable flags).',
            };
      case 'onnx':
        // QNBS-v3: ONNX Runtime Web uses WASM — always available, no GPU required.
        return { ok: true };
      case 'transformers':
        // QNBS-v3: Transformers.js uses WASM/WebGPU — connection test is always ok; model loads on first use.
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown provider' };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
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
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
};
