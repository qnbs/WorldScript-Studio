/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import { z } from 'zod';
import type { AIProvider, AiCreativity, AiModel, GeminiSchema } from '../types';
import { assertCloudAiAllowed } from './ai/aiPolicy';
import { resolveProviderFallbackChain } from './ai/hybridFallback';
import {
  buildOpenRouterStyleHeaders,
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from './ai/modelNormalization';
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
  if (usesOfficialOpenAi && !opts.model.startsWith('gpt-')) {
    throw new Error(
      `OpenAI: Model "${opts.model}" is not a valid OpenAI model. Please select a GPT model (e.g. gpt-4o, gpt-4o-mini) in Settings.`,
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
  switch (o.provider) {
    case 'openai':
      return streamOpenAI(prompt, o, callbacks);
    case 'ollama':
      return streamOllama(prompt, o, callbacks);
    case 'anthropic':
      return streamAnthropic(prompt, o, callbacks);
    case 'grok':
      return streamGrok(prompt, o, callbacks);
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
  const o = withMergedAbortSignal(opts, signal);
  const chain = resolveProviderFallbackChain(o);
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const nextProvider = chain[i];
    if (nextProvider === undefined) continue;
    try {
      return await generateTextSingleProvider(prompt, creativity, { ...o, provider: nextProvider });
    } catch (err) {
      lastError = err;
      if (i === chain.length - 1) break;
    }
  }
  try {
    const local = await generateLocalText(prompt);
    return providerTextSchema.parse({ text: local.text }).text;
  } catch {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  const o = withMergedAbortSignal(opts, signal);
  const chain = resolveProviderFallbackChain(o);
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const nextProvider = chain[i];
    if (nextProvider === undefined) continue;
    try {
      await streamProvider(prompt, creativity, { ...o, provider: nextProvider }, callbacks, signal);
      return;
    } catch (error) {
      lastError = error;
      if (i === chain.length - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
    ? `You are a helpful assistant for StoryCraft Studio. Prefer the documentation excerpts below when they answer the question; otherwise give concise general guidance. Format using Markdown.\n\n${mergedBody}`
    : `You are a helpful assistant for a creative writing app called StoryCraft Studio. Answer the user's question concisely and clearly. Format your answer using Markdown. Question: ${sanitizePromptValue(question)}`;
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
