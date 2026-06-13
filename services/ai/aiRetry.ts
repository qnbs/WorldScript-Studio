/**
 * Transient AI call retries.
 * QNBS-v3: P1-F5 — exponential backoff with full jitter + `Retry-After` parsing (was linear).
 *          Cloud providers (429/503) get backed off with jitter to avoid thundering-herd;
 *          a server-supplied `Retry-After` always takes precedence over the computed delay.
 *          P1 Batch 1.1 — fail fast on non-retryable errors (auth/policy/invalid request/offline)
 *          via {@link classifyAiError}, instead of backing off a call that cannot succeed.
 */

import { createLogger } from '../logger';
import { classifyAiError } from './aiErrorTaxonomy';

const log = createLogger('ai.retry');
// QNBS-v3: Ties the log lines of one retry chain together. Per-call sequence id (no Date/random)
// — full cross-thread correlation-id propagation is a later Phase 1 increment.
let retrySeq = 0;

export const DEFAULT_AI_RETRY_ATTEMPTS = 2;
export const AI_RETRY_BASE_DELAY_MS = 400;
/** Cap for the computed exponential delay (before honoring a server Retry-After). */
export const AI_RETRY_MAX_DELAY_MS = 8000;
/** Hard ceiling for a server-supplied Retry-After, so a hostile/huge value can't hang the app. */
export const AI_RETRY_MAX_RETRY_AFTER_MS = 30000;

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Max computed exponential delay (per attempt) before jitter. Default {@link AI_RETRY_MAX_DELAY_MS}. */
  maxDelayMs?: number;
  /** Apply full jitter to the computed delay. Default true. */
  jitter?: boolean;
  /** Injectable RNG (0..1) — override for deterministic tests. Default Math.random. */
  rng?: () => number;
  /**
   * Predicate deciding whether a thrown error is worth retrying.
   * Default: `classifyAiError(err).retryable` — auth/policy/invalid-request/offline fail fast,
   * transient/rate-limit/network back off and retry. Pass a custom predicate to override.
   */
  shouldRetry?: (err: unknown) => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Exponential backoff with optional full jitter.
 * Raw delay = baseDelayMs * 2^attemptIndex, capped at maxDelayMs; full jitter scales it by rng()∈[0,1).
 */
export function computeRetryDelayMs(
  attemptIndex: number,
  opts?: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitter' | 'rng'>,
): number {
  const base = opts?.baseDelayMs ?? AI_RETRY_BASE_DELAY_MS;
  const maxDelay = opts?.maxDelayMs ?? AI_RETRY_MAX_DELAY_MS;
  const jitter = opts?.jitter ?? true;
  const rng = opts?.rng ?? Math.random;
  const raw = base * 2 ** Math.max(0, attemptIndex);
  const capped = Math.min(raw, maxDelay);
  return jitter ? rng() * capped : capped;
}

/**
 * Extract a `Retry-After` delay (ms) from a thrown error, if present.
 * Recognizes: `retryAfterMs` (number), `retryAfter` (seconds number or HTTP-date string),
 * and a `headers.get('retry-after')` accessor on the error or its `.response`.
 * Returns null when no hint is present. Clamped to {@link AI_RETRY_MAX_RETRY_AFTER_MS}.
 */
export function parseRetryAfterMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown> & {
    headers?: { get?: (name: string) => string | null };
    response?: { headers?: { get?: (name: string) => string | null } };
  };

  // 1) Explicit millisecond hint.
  if (typeof e['retryAfterMs'] === 'number' && Number.isFinite(e['retryAfterMs'])) {
    return clampRetryAfter(e['retryAfterMs'] as number);
  }

  // 2) `retryAfter` as seconds (number) or HTTP value (string).
  const direct = e['retryAfter'];
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return clampRetryAfter(direct * 1000);
  }

  // 3) `retryAfter` string (if any), then a Retry-After header on the error or its response.
  //    QNBS-v3: try each in order — an unparseable direct string must still fall back to a
  //    valid header rather than skipping server-directed backoff entirely.
  const headerVal =
    e.headers?.get?.('retry-after') ?? e.response?.headers?.get?.('retry-after') ?? null;
  const candidates = [typeof direct === 'string' ? direct : null, headerVal];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      const ms = retryAfterStringToMs(candidate);
      if (ms !== null) return clampRetryAfter(ms);
    }
  }

  return null;
}

function retryAfterStringToMs(value: string): number | null {
  const trimmed = value.trim();
  // delta-seconds form
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // HTTP-date form
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const diff = ts - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function clampRetryAfter(ms: number): number {
  return Math.min(Math.max(0, ms), AI_RETRY_MAX_RETRY_AFTER_MS);
}

export async function withTransientRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const attempts = opts?.attempts ?? DEFAULT_AI_RETRY_ATTEMPTS;
  const shouldRetry = opts?.shouldRetry ?? ((err: unknown) => classifyAiError(err).retryable);
  const correlationId = `air-${++retrySeq}`;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i >= attempts - 1) break;
      // QNBS-v3: fail fast — a non-retryable error (auth/policy/invalid request/offline) won't
      // succeed on retry; surface it immediately instead of backing off a doomed call.
      if (!shouldRetry(err)) {
        log
          .withContext({ correlationId, category: classifyAiError(err).category })
          .info('AI error is non-retryable; failing fast');
        break;
      }
      // QNBS-v3: server Retry-After wins over the computed backoff.
      const retryAfter = parseRetryAfterMs(err);
      const waitMs = retryAfter ?? computeRetryDelayMs(i, opts);
      log
        .withContext({
          correlationId,
          attempt: i + 1,
          of: attempts,
          category: classifyAiError(err).category,
          waitMs: Math.round(waitMs),
        })
        .info('retrying transient AI error');
      await delay(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
