/**
 * openrouterProvider.ts
 * ----------------------
 * OpenRouter cloud provider — unified OpenAI-compatible gateway with free-tier models.
 *
 * QNBS-v3: OpenRouter wraps many open-source providers behind one key and one endpoint.
 * The `:free` model suffix selects the free tier (rate-limited but zero cost).
 *
 * Features:
 * - Exponential backoff + Retry-After header respect (max 3 retries)
 * - Circuit breaker: after 4 consecutive 429s → block for 5 min
 * - Usage counter: tracks RPM approximation for UX indicator
 * - Structured routing log on every decision
 *
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Headers: HTTP-Referer + X-Title (OpenRouter ranking / credits)
 * Key storage: 'openrouter' key in storageService (AES-256-GCM at rest)
 */

import type { AIRequestOptions, AIStreamCallbacks } from '../../aiProviderService';
import { sanitizePromptValue } from '../../aiUtils';
import { createLogger } from '../../logger';

const logger = createLogger('openrouter-provider');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const SITE_URL = 'https://github.com/qnbs/StoryCraft-Studio';
const SITE_TITLE = 'StoryCraft Studio';

// ─── Free-tier model catalog ─────────────────────────────────────────────────

// QNBS-v3: Strong free-tier models with `:free` suffix. Fallback order matters:
// DeepSeek R1 is best for reasoning; Llama 70B is best for creative writing.
export const OPENROUTER_FREE_MODELS = [
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen2.5-72b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-7b-instruct:free',
] as const;

export type OpenRouterFreeModel = (typeof OPENROUTER_FREE_MODELS)[number];

export function isOpenRouterFreeModel(model: string): boolean {
  return model.endsWith(':free');
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

const MAX_CONSECUTIVE_429 = 4;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutes

let _consecutive429 = 0;
let _circuitOpenUntil = 0;

export function isCircuitOpen(): boolean {
  if (_circuitOpenUntil === 0) return false;
  if (Date.now() >= _circuitOpenUntil) {
    // QNBS-v3: Auto-reset after cooldown.
    _circuitOpenUntil = 0;
    _consecutive429 = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  _consecutive429 = 0;
}

function recordRateLimit(): void {
  _consecutive429 += 1;
  if (_consecutive429 >= MAX_CONSECUTIVE_429) {
    _circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    logger.warn('OpenRouter circuit breaker OPEN — too many 429s; pausing for 5 minutes');
  }
}

/** Reset circuit breaker state (used by tests and Settings "Reset" action). */
export function resetOpenRouterCircuit(): void {
  _consecutive429 = 0;
  _circuitOpenUntil = 0;
}

// ─── Usage approximation ──────────────────────────────────────────────────────
// Tracks requests in the last 60 seconds to give the UI an RPM approximation.

const _requestTimestamps: number[] = [];

function recordRequest(): void {
  const now = Date.now();
  _requestTimestamps.push(now);
  // Keep only timestamps within the last 60 seconds.
  const cutoff = now - 60_000;
  while (_requestTimestamps.length > 0 && (_requestTimestamps[0] ?? 0) < cutoff) {
    _requestTimestamps.shift();
  }
}

/** Approximate requests-per-minute in the last 60 seconds. */
export function getApproxRpm(): number {
  const now = Date.now();
  const cutoff = now - 60_000;
  return _requestTimestamps.filter((t) => t >= cutoff).length;
}

// ─── Retry + backoff helpers ─────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15_000;

function computeBackoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const parsed = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      // QNBS-v3: Respect Retry-After header, cap at 30 s to avoid infinite waits.
      return Math.min(parsed * 1000, 30_000);
    }
  }
  // Exponential backoff: 1s, 2s, 4s, 8s… capped at MAX_DELAY_MS.
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Request builder ─────────────────────────────────────────────────────────

function buildMessages(
  prompt: string,
  systemPrompt?: string,
): Array<{ role: string; content: string }> {
  if (systemPrompt?.trim()) {
    return [
      { role: 'system', content: sanitizePromptValue(systemPrompt) },
      { role: 'user', content: sanitizePromptValue(prompt) },
    ];
  }
  return [{ role: 'user', content: sanitizePromptValue(prompt) }];
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': SITE_URL,
    'X-Title': SITE_TITLE,
  };
}

// ─── Streaming generation ─────────────────────────────────────────────────────

/** SSE-streaming OpenRouter completion with retry + backoff + circuit breaker. */
export async function streamOpenRouter(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  apiKey: string,
): Promise<void> {
  if (isCircuitOpen()) {
    throw new Error(
      'OPENROUTER_CIRCUIT_OPEN: Provider temporarily paused due to repeated rate limits. Using fallback provider.',
    );
  }

  const messages = buildMessages(prompt, opts.systemPrompt);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    recordRequest();
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
      }),
      signal: opts.signal ?? null,
    });

    if (res.status === 429) {
      recordRateLimit();
      if (attempt === MAX_RETRIES) {
        throw new Error(
          'OPENROUTER_RATE_LIMITED: Rate limit persistent after retries. Falling back to next provider.',
        );
      }
      const backoff = computeBackoffMs(attempt, res.headers.get('retry-after'));
      logger.warn(
        `OpenRouter 429 — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await delay(backoff);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as { error?: { message?: string } })?.error?.message ?? res.statusText;
      throw new Error(`OpenRouter API Error ${res.status}: ${msg}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('OpenRouter: No response body');

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
          const json = JSON.parse(line.slice(6)) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json?.choices?.[0]?.delta?.content ?? '';
          if (delta) callbacks.onChunk(delta);
        } catch {
          // malformed SSE chunk — skip
        }
      }
    }

    recordSuccess();
    callbacks.onDone?.();
    return; // success
  }
}

// ─── Non-streaming generation (ProForge pipeline) ────────────────────────────

/** Blocking OpenRouter text generation with retry + backoff + circuit breaker. */
export async function generateOpenRouterText(
  prompt: string,
  opts: AIRequestOptions,
  apiKey: string,
): Promise<string> {
  if (isCircuitOpen()) {
    throw new Error(
      'OPENROUTER_CIRCUIT_OPEN: Provider temporarily paused due to repeated rate limits. Using fallback provider.',
    );
  }

  const messages = buildMessages(prompt, opts.systemPrompt);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const callStart = performance.now();
    recordRequest();

    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
      }),
      signal: opts.signal ?? null,
    });

    const latencyMs = Math.round(performance.now() - callStart);

    if (res.status === 429) {
      recordRateLimit();
      if (attempt === MAX_RETRIES) {
        throw new Error(
          'OPENROUTER_RATE_LIMITED: Rate limit persistent after retries. Falling back to next provider.',
        );
      }
      const backoff = computeBackoffMs(attempt, res.headers.get('retry-after'));
      logger.warn(
        `OpenRouter 429 — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await delay(backoff);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as { error?: { message?: string } })?.error?.message ?? res.statusText;
      throw new Error(`OpenRouter API Error ${res.status}: ${msg}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';

    if (!text) throw new Error('OpenRouter: Empty response from model');

    recordSuccess();
    logger.info('openrouter-completion', {
      model: opts.model,
      isFree: isOpenRouterFreeModel(opts.model),
      latencyMs,
      approxRpm: getApproxRpm(),
    });

    return text;
  }

  // Should never reach here (loop exits via return or throw), but satisfies TypeScript.
  throw new Error('OpenRouter: Unexpected retry loop exit');
}
