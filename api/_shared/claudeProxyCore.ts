// QNBS-v3 (ADR-0016 Track B): platform-agnostic relay core, shared by the Vercel Edge Function
// (api/claude-proxy.ts) and the Cloudflare Pages Function (functions/api/claude-proxy.ts) so the
// abuse-control logic — the actual security-relevant part — is written and tested exactly once.
// Web-standard Request/Response only; no platform-specific types, so it needs neither @vercel/node
// nor @cloudflare/workers-types as a new dependency.
import { z } from 'zod';
import { ANTHROPIC_MODEL_IDS } from '../../services/ai/cloudModelCatalog';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// QNBS-v3: mirrors the model dropdown in AiProviderCard.tsx (Track A) — keeping the enum in sync
// is a deliberate defense-in-depth constraint, not just laziness: it stops the public endpoint from
// being used to probe/relay requests for arbitrary future Anthropic model ids.
export const ALLOWED_MODELS = ANTHROPIC_MODEL_IDS;

// QNBS-v3: this app only ever sends a single user message (see streamAnthropic in
// aiProviderService.ts) — the small array cap leaves room for a future multi-turn use case without
// letting the body-size/message-count limits do any real abuse-prevention work.
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 100_000;
const MAX_BODY_BYTES = 262_144; // 256 KiB
const MAX_TOKENS_CEILING = 8192;
const OUTBOUND_TIMEOUT_MS = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
// QNBS-v3: bounds the rate-limit map itself — without this a burst of distinct spoofed
// X-Forwarded-For values would turn the limiter into its own unbounded-memory DoS vector.
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5000;

const claudeProxyRequestSchema = z.object({
  apiKey: z.string().min(20).max(200),
  model: z.enum(ALLOWED_MODELS),
  maxTokens: z.number().int().positive().max(MAX_TOKENS_CEILING).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
});

// QNBS-v3: module-level so it survives across invocations on a warm edge/worker instance — a
// best-effort, single-instance limiter (explicitly accepted in the plan/ADR: true distributed rate
// limiting needs a platform KV/rate-limit product, which this app does not depend on).
const rateLimitLog = new Map<string, number[]>();

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const recent = (rateLimitLog.get(clientId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  recent.push(now);
  rateLimitLog.set(clientId, recent);
  // QNBS-v3 (CodeRabbit, PR #301): a spoofed x-forwarded-for burst must not be able to reset every
  // real client's window via a wholesale .clear() (CWE-770) — evict stale entries first, then oldest
  // by insertion order, and never evict the current client.
  if (rateLimitLog.size > RATE_LIMIT_MAX_TRACKED_CLIENTS) {
    for (const [id, stamps] of rateLimitLog) {
      if (id !== clientId && stamps.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        rateLimitLog.delete(id);
      }
    }
    for (const id of rateLimitLog.keys()) {
      if (rateLimitLog.size <= RATE_LIMIT_MAX_TRACKED_CLIENTS) break;
      if (id !== clientId) rateLimitLog.delete(id);
    }
  }
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function clientIdFor(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const first = forwardedFor?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // QNBS-v3: this is a stateless per-request relay of user-specific, key-authenticated content
      // — it must never be cached by any CDN/browser layer.
      'cache-control': 'no-store',
    },
  });
}

/**
 * Relays a validated `{ apiKey, model, messages, maxTokens? }` body to the Anthropic Messages API
 * and returns Anthropic's own JSON response (or a proxy-level error) unmodified, so client-side
 * parsing is identical whether it called Anthropic directly (Track A, desktop) or via this proxy
 * (Track B, web). Never logs the API key, prompt, or response — see ADR-0016 statelessness guarantee.
 */
export async function handleClaudeProxyRequest(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!isSameOriginRequest(request)) {
    return jsonResponse(403, { error: 'Origin not allowed' });
  }

  const clientId = clientIdFor(request);
  if (isRateLimited(clientId)) {
    return jsonResponse(429, { error: 'Rate limit exceeded' });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'Request body too large' });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse(400, { error: 'Could not read request body' });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'Request body too large' });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const validated = claudeProxyRequestSchema.safeParse(parsedBody);
  if (!validated.success) {
    return jsonResponse(400, { error: 'Request body failed validation' });
  }
  const { apiKey, model, messages, maxTokens } = validated.data;

  try {
    const upstreamResponse = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens ?? 2048,
        messages,
      }),
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    const upstreamText = await upstreamResponse.text();
    return new Response(upstreamText, {
      status: upstreamResponse.status,
      headers: {
        'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return jsonResponse(isTimeout ? 504 : 502, {
      error: isTimeout ? 'Upstream request timed out' : 'Upstream request failed',
    });
  }
}
