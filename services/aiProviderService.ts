/**
 * Unified AI Provider Service
 * Supports: Gemini (default), OpenAI, Ollama (local)
 *
 * API keys are stored encrypted via storageService.
 * Streaming is supported for all providers.
 */

import type { AIProvider, AiModel } from '../types';
import { storageService } from './storageService';

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

export interface AIRequestOptions {
  model: AiModel;
  provider: AIProvider;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  ollamaBaseUrl?: string;
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
    throw new Error('NO_API_KEY: OpenAI API Key fehlt. Bitte in den Einstellungen eintragen.');

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
  if (!reader) throw new Error('OpenAI: Kein Response-Body');

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

// ─── Ollama Provider ──────────────────────────────────────────────────────────

async function streamOllama(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const baseUrl = opts.ollamaBaseUrl ?? 'http://localhost:11434';
  // Strip "ollama/" prefix if present
  const model = opts.model.replace(/^ollama\//, '');

  const body: Record<string, unknown> = {
    model,
    prompt: opts.systemPrompt
      ? `${sanitizeProviderPrompt(opts.systemPrompt)}\n\n${sanitizeProviderPrompt(prompt)}`
      : sanitizeProviderPrompt(prompt),
    stream: true,
    options: {
      temperature: opts.temperature ?? 0.7,
      num_predict: opts.maxTokens ?? 2048,
    },
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal ?? null,
    });
  } catch (err) {
    throw new Error(
      `Ollama nicht erreichbar (${baseUrl}). Stellen Sie sicher, dass Ollama läuft: ollama serve`,
      { cause: err }
    );
  }

  if (!res.ok) {
    throw new Error(`Ollama API Error ${res.status}: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Ollama: Kein Response-Body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) callbacks.onChunk(json.response);
        if (json.done) callbacks.onDone?.();
      } catch {
        // malformed chunk – skip
      }
    }
  }
}

// ─── Anthropic/Claude (Browser-Hinweis) ─────────────────────────────────────

async function streamAnthropic(
  _prompt: string,
  _opts: AIRequestOptions,
  _callbacks: AIStreamCallbacks
): Promise<void> {
  // Anthropic's API blocks direct browser requests (CORS).
  // A proxy backend is required. Show a helpful error.
  throw new Error(
    'Claude/Anthropic: Direkte Browser-Anfragen werden von Anthropic blockiert (CORS). ' +
      'Bitte verwende einen Backend-Proxy oder wechsle zu Gemini/OpenAI/Ollama.'
  );
}

// ─── Unified stream function ──────────────────────────────────────────────────

/**
 * Stream text from the configured AI provider.
 * Automatically routes to Gemini, OpenAI, Ollama, or Anthropic.
 */
export async function streamAI(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks
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
      // Gemini is handled by the existing geminiService.ts
      // This is a fallback for when gemini is explicitly selected
      throw new Error(
        'Gemini Provider: Bitte geminiService.ts direkt nutzen. ' +
          'aiProviderService ist für OpenAI/Ollama/Anthropic.'
      );
  }
}

/**
 * Test connection to the given provider.
 * Returns { ok: true } or { ok: false, error: string }.
 */
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
      case 'ollama': {
        const base = opts.ollamaBaseUrl ?? 'http://localhost:11434';
        const res = await fetch(`${base}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
        return { ok: true };
      }
      case 'anthropic':
        return {
          ok: false,
          error: 'Claude benötigt einen Backend-Proxy (CORS-Einschränkung)',
        };
      case 'gemini':
        return { ok: true }; // Tested via existing geminiService
      default:
        return { ok: false, error: 'Unbekannter Provider' };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * List available Ollama models from the local server.
 */
export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}
