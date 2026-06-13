/**
 * AI error taxonomy.
 * QNBS-v3: P1 (Batch 1.1) — classify AI/provider errors so the retry layer can fail fast on
 *          non-retryable errors (auth, policy, invalid request, offline) instead of backing off
 *          a doomed call, and so the UI (Batch 1.2) can map a stable `messageKey` to an
 *          actionable hint. Pure + dependency-free; consumed by `aiRetry.withTransientRetry`.
 */

export type AiErrorCategory =
  | 'transient'
  | 'rateLimit'
  | 'auth'
  | 'network'
  | 'offline'
  | 'policy'
  | 'invalidRequest'
  | 'canceled'
  | 'permanent';

export interface AiErrorClassification {
  readonly category: AiErrorCategory;
  /** Whether retrying the same call could plausibly succeed. */
  readonly retryable: boolean;
  /** Stable i18n key — wired into locales + UI recovery in Batch 1.2. */
  readonly messageKey: string;
}

// QNBS-v3: Only connection-class failures are worth a retry. auth/policy/invalidRequest are
// deterministic (a retry repeats the same failure); offline is doomed until connectivity returns.
const RETRYABLE: ReadonlySet<AiErrorCategory> = new Set<AiErrorCategory>([
  'transient',
  'rateLimit',
  'network',
]);

function classificationFor(category: AiErrorCategory): AiErrorClassification {
  return { category, retryable: RETRYABLE.has(category), messageKey: `errors.ai.${category}` };
}

/** Best-effort numeric HTTP status from common provider/SDK error shapes. */
function extractStatus(err: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'statusCode'] as const) {
    const v = err[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const response = err['response'];
  if (response && typeof response === 'object') {
    const s = (response as Record<string, unknown>)['status'];
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return undefined;
}

function categoryFromStatus(status: number): AiErrorCategory | undefined {
  if (status === 429) return 'rateLimit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'transient'; // request timeout — worth a retry
  if (status >= 400 && status < 500) return 'invalidRequest';
  if (status >= 500) return 'transient';
  return undefined;
}

function categoryFromMessage(message: string): AiErrorCategory | undefined {
  const m = message.toLowerCase();
  // Policy-gate markers from services/ai/aiPolicy.ts all read "...blocked...".
  if (m.includes('blocked')) return 'policy';
  if (/(rate limit|too many requests|\b429\b)/.test(m)) return 'rateLimit';
  if (/(unauthorized|forbidden|invalid api key|api key|authentication|\b401\b|\b403\b)/.test(m)) {
    return 'auth';
  }
  if (/(invalid request|bad request|unprocessable|\b400\b|\b404\b|\b422\b)/.test(m)) {
    return 'invalidRequest';
  }
  // QNBS-v3: deliberate cancellation must fail fast — never retry a user/timeout abort.
  if (/(\baborted\b|operation was aborted|\bcancell?ed\b)/.test(m)) {
    return 'canceled';
  }
  if (/(timeout|timed out|etimedout|econnreset|socket hang up)/.test(m)) {
    return 'transient';
  }
  if (/(failed to fetch|networkerror|network error|enotfound|econnrefused|fetch failed)/.test(m)) {
    return 'network';
  }
  return undefined;
}

function isOffline(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.onLine === 'boolean' &&
    navigator.onLine === false
  );
}

/**
 * Classify an arbitrary thrown value from the AI/provider layer.
 * Ordering: offline (device-level) → HTTP status → message markers → conservative default.
 * Unknown/unclassifiable errors default to retryable `transient` to preserve the historical
 * "retry on failure" behavior; only confidently-classified deterministic errors fail fast.
 */
export function classifyAiError(err: unknown): AiErrorClassification {
  // Offline trumps everything — retrying a cloud call while the device is offline is doomed.
  if (isOffline()) return classificationFor('offline');

  if (typeof err !== 'object' || err === null) {
    return classificationFor('transient');
  }
  const e = err as Record<string, unknown>;

  // QNBS-v3: a deliberate AbortController cancellation surfaces as DOMException 'AbortError'
  // (or legacy code 20) — fail fast, retrying a cancelled request is never correct.
  if (e['name'] === 'AbortError' || e['code'] === 20) {
    return classificationFor('canceled');
  }

  const status = extractStatus(e);
  if (status !== undefined) {
    const byStatus = categoryFromStatus(status);
    if (byStatus) return classificationFor(byStatus);
  }

  const message = typeof e['message'] === 'string' ? e['message'] : '';
  if (message) {
    const byMessage = categoryFromMessage(message);
    if (byMessage) return classificationFor(byMessage);
  }

  // A `fetch` network failure is commonly a bare TypeError mentioning fetch.
  if (e['name'] === 'TypeError' && /fetch/i.test(message)) return classificationFor('network');

  return classificationFor('transient');
}
