/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import type { AIProvider, AiModel, AiCreativity, GeminiSchema } from '../types';
import { storageService } from './storageService';
import {
  listOllamaModels as listOllamaModelsFromService,
  streamOllama,
  testOllamaConnection,
} from './ollamaService';
import {
  generateText as generateTextGemini,
  generateJson as generateJsonGemini,
  streamText as streamTextGemini,
  generateImage as generateImageGemini,
  streamAiHelpResponse as streamAiHelpResponseGemini,
} from './geminiService';

const stripControlChars = (value: string): string => {
  let output = '';
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return output;
};

const sanitizeProviderPrompt = (prompt: string): string =>
  stripControlChars(prompt).replace(/```/g, '"').replace(/\s+/g, ' ').trim();

const attachCause = <T extends Error>(error: T, cause: unknown): T => {
  Object.defineProperty(error, 'cause', {
    value: cause,
    enumerable: false,
    configurable: true,
  });
  return error;
};

export interface AIRequestOptions {
  model: AiModel;
  provider: AIProvider;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  ollamaBaseUrl?: string;
  fallbackProviders?: AIProvider[];
}

export interface AIStreamCallbacks {
  onChunk: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

// ─── Gemini Provider ──────────────────────────────────────────────────────────
// Gemini streaming is handled by the existing geminiService.ts.
// We re-export a compatible interface here.

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

async function streamOpenAI(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const apiKey = await storageService.getApiKey('openai');
  if (!apiKey)
    throw new Error('NO_API_KEY: OpenAI API key missing. Please enter it in Settings.');

  const model = opts.model.startsWith('gpt-') ? opts.model : 'gpt-4o-mini';
  const messages = opts.systemPrompt
    ? [
        { role: 'system', content: sanitizeProviderPrompt(opts.systemPrompt) },
        { role: 'user', content: sanitizeProviderPrompt(prompt) },
      ]
    : [{ role: 'user', content: sanitizeProviderPrompt(prompt) }];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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
      `OpenAI API Error ${res.status}: ${(err as { error?: { message?: string } })?.error?.message ?? res.statusText}`
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('OpenAI: No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
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
  _callbacks: AIStreamCallbacks
): Promise<void> {
  throw new Error(
    'Claude/Anthropic: Direct browser requests are blocked by Anthropic (CORS). ' +
      'Please use a backend proxy or switch to Gemini/OpenAI/Ollama.'
  );
}

async function streamProvider(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  switch (opts.provider) {
    case 'openai':
      return streamOpenAI(prompt, opts, callbacks);
    case 'ollama':
      return streamOllama(prompt, opts, callbacks);
    case 'anthropic':
      return streamAnthropic(prompt, opts, callbacks);
    case 'gemini':
    default:
      return streamTextGemini(
        opts.systemPrompt
          ? `${sanitizeProviderPrompt(opts.systemPrompt)}\n\n${sanitizeProviderPrompt(prompt)}`
          : prompt,
        creativity,
        callbacks.onChunk,
        signal
      );
  }
}

export async function generateText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  signal?: AbortSignal
): Promise<string> {
  switch (opts.provider) {
    case 'openai': {
      let result = '';
      await streamOpenAI(prompt, opts, {
        onChunk: (text) => {
          result += text;
        },
      });
      return result;
    }
    case 'ollama': {
      let result = '';
      await streamOllama(prompt, opts, {
        onChunk: (text) => {
          result += text;
        },
      });
      return result;
    }
    case 'anthropic':
      throw new Error(
        'Claude/Anthropic is currently not available in the browser. Please use Gemini, OpenAI or Ollama.'
      );
    case 'gemini':
    default:
      return generateTextGemini(prompt, creativity, signal);
  }
}

export async function generateJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal
): Promise<T> {
  if (opts.provider === 'gemini') {
    return generateJsonGemini(prompt, creativity, schema, signal);
  }

  const raw = await generateText(prompt, creativity, opts, signal);
  let jsonText = raw.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(jsonText) as T;
  } catch (parseError) {
    const parseErr = new Error(
      'The AI model response is not valid JSON. Please try again.'
    );
    attachCause(parseErr, parseError);
    throw parseErr;
  }
}

export async function generateImage(
  prompt: string,
  opts: AIRequestOptions,
  signal?: AbortSignal
): Promise<string> {
  switch (opts.provider) {
    case 'gemini':
      return generateImageGemini(prompt, signal);
    case 'openai':
      throw new Error(
        'OpenAI image generation is currently not available via the browser version.'
      );
    case 'ollama':
      throw new Error(
        'Ollama image generation is currently not supported. Please use Gemini for images.'
      );
    case 'anthropic':
      throw new Error(
        'Anthropic image generation is not available. Please use Gemini or Ollama for image content.'
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
  signal?: AbortSignal
): Promise<void> {
  try {
    await streamProvider(prompt, creativity, opts, callbacks, signal);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      opts.fallbackProviders?.includes('gemini') &&
      opts.provider === 'ollama'
    ) {
      await streamProvider(prompt, creativity, { ...opts, provider: 'gemini' }, callbacks, signal);
      return;
    }
    throw error;
  }
}

export async function streamAiHelpResponse(
  question: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const helpPrompt = `You are a helpful assistant for a creative writing app called StoryCraft Studio. Answer the user's question concisely and clearly. Format your answer using Markdown. Question: ${sanitizeProviderPrompt(question)}`;
  if (opts.provider === 'gemini') {
    return streamAiHelpResponseGemini(
      question,
      callbacks.onChunk,
      opts.temperature ?? 0.7,
      opts.signal
    );
  }
  return streamProvider(helpPrompt, creativity, opts, callbacks, opts.signal);
}

export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  return listOllamaModelsFromService(baseUrl);
}

export async function testAIConnection(
  provider: AIProvider,
  opts: Partial<AIRequestOptions>
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const apiKey = await storageService.getApiKey('openai');
        if (!apiKey) return { ok: false, error: 'Kein OpenAI API Key gesetzt' };
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }
      case 'ollama':
        return testOllamaConnection(opts.ollamaBaseUrl);
      case 'anthropic':
        return {
          ok: false,
          error: 'Claude requires a backend proxy (CORS restriction)',
        };
      case 'gemini':
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
