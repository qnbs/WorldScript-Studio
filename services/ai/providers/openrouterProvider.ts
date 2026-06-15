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
 * - Circuit-breaker state mirrored to localStorage so a reload does not forget a rate-limit pause.
 *
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Headers: HTTP-Referer + X-Title (OpenRouter ranking / credits)
 * Key storage: 'openrouter' key in storageService (AES-256-GCM at rest)
 */

import type { AIRequestOptions, AIStreamCallbacks } from '../../aiProviderService';
import { sanitizePromptValue } from '../../aiUtils';
import { createLogger } from '../../logger';
import { isOpenRouterFreeModel } from '../openrouterModels';

const logger = createLogger('openrouter-provider');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const SITE_URL = 'https://github.com/qnbs/WorldScript-Studio';
const SITE_TITLE = 'WorldScript Studio';

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

export { isOpenRouterFreeModel };

// ─── Circuit breaker ─────────────────────────────────────────────────────────

const MAX_CONSECUTIVE_429 = 4;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutes
const CB_STORAGE_KEY = 'worldscript-or-cb-state';

// QNBS-v3: Only the pause deadline is persisted. The "consecutive" 429 counter is deliberately
// NOT persisted — restoring it would let a stale count survive a long idle period so that a single
// later 429 trips the circuit as if the failures were contiguous. The counter is in-memory only.
interface CircuitBreakerState {
  circuitOpenUntil: number;
}

let _consecutive429 = 0;
let _circuitOpenUntil = 0;
let _cbInitialized = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && window.localStorage !== undefined;
}

function readCircuitStateFromStorage(): CircuitBreakerState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(CB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CircuitBreakerState;
    if (typeof parsed.circuitOpenUntil !== 'number') {
      return null;
    }
    return { circuitOpenUntil: parsed.circuitOpenUntil };
  } catch {
    return null;
  }
}

function writeCircuitStateToStorage(): void {
  if (!isBrowser()) return;
  try {
    const state: CircuitBreakerState = { circuitOpenUntil: _circuitOpenUntil };
    window.localStorage.setItem(CB_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    logger.warn('Failed to persist OpenRouter circuit state', { error: String(err) });
  }
}

function initCircuitState(): void {
  if (_cbInitialized) return;
  _cbInitialized = true;
  const stored = readCircuitStateFromStorage();
  if (stored) {
    // QNBS-v3: Restore only the pause deadline; the consecutive counter stays at 0 so it can't
    // carry stale non-contiguous failures across a reload.
    _circuitOpenUntil = stored.circuitOpenUntil;
  }
}

export function isCircuitOpen(): boolean {
  initCircuitState();
  if (_circuitOpenUntil === 0) return false;
  if (Date.now() >= _circuitOpenUntil) {
    // QNBS-v3: Auto-reset after cooldown.
    _circuitOpenUntil = 0;
    _consecutive429 = 0;
    writeCircuitStateToStorage();
    return false;
  }
  return true;
}

function recordSuccess(): void {
  initCircuitState();
  _consecutive429 = 0;
  writeCircuitStateToStorage();
}

function recordRateLimit(): void {
  initCircuitState();
  _consecutive429 += 1;
  if (_consecutive429 >= MAX_CONSECUTIVE_429) {
    _circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    logger.warn('OpenRouter circuit breaker OPEN — too many 429s; pausing for 5 minutes');
  }
  writeCircuitStateToStorage();
}

/** Reset circuit breaker state (used by tests and Settings "Reset" action). */
export function resetOpenRouterCircuit(): void {
  _consecutive429 = 0;
  _circuitOpenUntil = 0;
  writeCircuitStateToStorage();
}

/** Test-only helper to clear the in-memory and persisted circuit state. */
export function __resetOpenRouterCircuitForTest(): void {
  _consecutive429 = 0;
  _circuitOpenUntil = 0;
  _cbInitialized = false;
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(CB_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

// ─── Usage approximation ──────────────────────────────────────────────────────
// Tracks requests in the last 60 seconds to give the UI an RPM approximation.

const _requestTimestamps: number[] = [];

function trimOldRequests(now: number): void {
  const cutoff = now - 60_000;
  while (_requestTimestamps.length > 0 && (_requestTimestamps[0] ?? 0) < cutoff) {
    _requestTimestamps.shift();
  }
}

function recordRequest(): void {
  const now = Date.now();
  _requestTimestamps.push(now);
  // QNBS-v3: Trim on every request so the array cannot grow unbounded when
  // getApproxRpm() is never called.
  trimOldRequests(now);
}

/** Approximate requests-per-minute in the last 60 seconds. */
export function getApproxRpm(): number {
  const now = Date.now();
  trimOldRequests(now);
  return _requestTimestamps.length;
}

/** Test-only helper to clear the RPM window. */
export function __resetRequestTimestampsForTest(): void {
  _requestTimestamps.length = 0;
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

let _delayProvider: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function delay(ms: number): Promise<void> {
  return _delayProvider(ms);
}

/** Test-only hook to swap the retry delay provider (e.g. fake timers). */
export function __setTestDelayProvider(provider: (ms: number) => Promise<void>): void {
  _delayProvider = provider;
}

/** Reset the retry delay provider to the default setTimeout implementation. */
export function __resetTestDelayProvider(): void {
  _delayProvider = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

interface OpenRouterRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
}

function buildRequestBody(
  prompt: string,
  opts: AIRequestOptions,
  stream: boolean,
): OpenRouterRequestBody {
  return {
    model: opts.model,
    messages: buildMessages(prompt, opts.systemPrompt),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    stream,
  };
}

function enrichErrorWithStatus(err: unknown, status: number): Error {
  if (err instanceof Error) {
    (err as Error & { status?: number }).status = status;
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ─── Streaming generation ─────────────────────────────────────────────────────
// QNBS-v3: streamOpenRouter intentionally does NOT invoke callbacks.onError — it only
// throws. The orchestration layer (aiProviderService.streamText) owns the onError contract
// and fires it once, after the whole fallback chain is exhausted, so callers never receive
// a terminal error callback while a fallback provider is still about to succeed.

/** SSE-streaming OpenRouter completion with retry + backoff + circuit breaker. */
export async function streamOpenRouter(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  apiKey: string,
): Promise<void> {
  if (isCircuitOpen()) {
    const err = new Error(
      'OPENROUTER_CIRCUIT_OPEN: Provider temporarily paused due to repeated rate limits. Using fallback provider.',
    );
    throw err;
  }

  const body = buildRequestBody(prompt, opts, true);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    recordRequest();
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal: opts.signal ?? null,
    });

    if (res.status === 429) {
      recordRateLimit();
      if (attempt === MAX_RETRIES) {
        const err = new Error(
          'OPENROUTER_RATE_LIMITED: Rate limit persistent after retries. Falling back to next provider.',
        );
        throw err;
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
      const err = enrichErrorWithStatus(
        new Error(`OpenRouter API Error ${res.status}: ${msg}`),
        res.status,
      );
      throw err;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const err = new Error('OpenRouter: No response body');
      throw err;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
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
    } catch (readErr) {
      const err = readErr instanceof Error ? readErr : new Error(String(readErr));
      throw err;
    }

    // QNBS-v3: A request cancelled mid-stream is NOT a successful completion — exit via the abort
    // error path instead of recording success / firing onDone, so callers don't run downstream
    // completion flows for a request the user (or a newer request) cancelled.
    if (opts.signal?.aborted) {
      throw new DOMException('OpenRouter stream aborted', 'AbortError');
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

  const body = buildRequestBody(prompt, opts, false);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const callStart = performance.now();
    recordRequest();

    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
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
