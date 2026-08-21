import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleClaudeProxyRequest } from '../../../api/_shared/claudeProxyCore';

const PROXY_URL = 'https://worldscript-studio.vercel.app/api/claude-proxy';
const VALID_ORIGIN = 'https://worldscript-studio.vercel.app';
const VALID_API_KEY = 'sk-ant-api03-'.padEnd(30, 'x');

function makeRequest(
  body: unknown,
  overrides: { method?: string; origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(overrides.headers ?? {});
  if (overrides.origin !== null) {
    headers.set('origin', overrides.origin ?? VALID_ORIGIN);
  }
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  if (!headers.has('content-length')) {
    headers.set('content-length', String(new TextEncoder().encode(rawBody).length));
  }
  const method = overrides.method ?? 'POST';
  // QNBS-v3: the Fetch spec forbids a body on GET/HEAD requests — the 405 test only needs the
  // method + headers to reach the method check, never an actual body.
  const bodyAllowed = method !== 'GET' && method !== 'HEAD';
  return new Request(PROXY_URL, {
    method,
    headers,
    ...(bodyAllowed ? { body: rawBody } : {}),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: VALID_API_KEY,
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'Hello Claude' }],
    ...overrides,
  };
}

// QNBS-v3: each test uses a distinct x-forwarded-for so the module-level rate-limit map
// (keyed by client IP) never leaks state across unrelated test cases.
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 255}`;
}

describe('handleClaudeProxyRequest', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // QNBS-v3: statelessness guarantee (ADR-0016) — the handler must never log the API key,
    // messages, or any other request/response payload content, on any code path.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects non-POST methods with 405', async () => {
    const req = makeRequest(validBody(), {
      method: 'GET',
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(405);
  });

  it('rejects a request with no Origin header with 403', async () => {
    const req = makeRequest(validBody(), {
      origin: null,
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin request with 403', async () => {
    const req = makeRequest(validBody(), {
      origin: 'https://evil.example.com',
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(403);
  });

  it('rejects a body over the declared content-length limit with 413', async () => {
    const oversizedBody = validBody({ messages: [{ role: 'user', content: 'x'.repeat(300_000) }] });
    const req = makeRequest(oversizedBody, { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(413);
  });

  it('rejects a spoofed content-length by re-checking the actual body length', async () => {
    const oversizedText = JSON.stringify(
      validBody({ messages: [{ role: 'user', content: 'x'.repeat(300_000) }] }),
    );
    const req = makeRequest(oversizedText, {
      headers: { 'x-forwarded-for': uniqueIp(), 'content-length': '10' },
    });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(413);
  });

  it('rejects invalid JSON with 400', async () => {
    const req = makeRequest('{not valid json', { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(400);
  });

  it('rejects a body that fails schema validation (missing apiKey) with 400', async () => {
    const invalidBody: Record<string, unknown> = validBody();
    delete invalidBody['apiKey'];
    const req = makeRequest(invalidBody, { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(400);
  });

  it('rejects an unlisted model with 400', async () => {
    const req = makeRequest(validBody({ model: 'claude-does-not-exist' }), {
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const res = await handleClaudeProxyRequest(req);
    expect(res.status).toBe(400);
  });

  it('rate-limits a client after exceeding the per-window request count', async () => {
    const ip = uniqueIp();
    let lastRes: Response | undefined;
    for (let i = 0; i < 21; i++) {
      const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': ip } });
      lastRes = await handleClaudeProxyRequest(
        req,
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
            status: 200,
          }),
        ),
      );
    }
    expect(lastRes?.status).toBe(429);
  });

  it('relays a valid request to Anthropic and passes the response through unmodified', async () => {
    const upstreamBody = { content: [{ type: 'text', text: 'Hello from Claude' }] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(upstreamBody), { status: 200 }));
    const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': uniqueIp() } });

    const res = await handleClaudeProxyRequest(req, fetchImpl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstreamBody);
    expect(res.headers.get('cache-control')).toBe('no-store');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const sentHeaders = init.headers as Record<string, string>;
    expect(sentHeaders['x-api-key']).toBe(VALID_API_KEY);
    expect(sentHeaders['anthropic-version']).toBe('2023-06-01');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe('claude-sonnet-5');
    expect(sentBody.max_tokens).toBe(2048);
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'Hello Claude' }]);
  });

  it('honors a caller-supplied maxTokens instead of the 2048 default', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    const req = makeRequest(validBody({ maxTokens: 512 }), {
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    await handleClaudeProxyRequest(req, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).max_tokens).toBe(512);
  });

  it('propagates a non-2xx upstream status and body unchanged', async () => {
    const errorBody = { type: 'error', error: { message: 'invalid x-api-key' } };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 401 }));
    const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req, fetchImpl);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(errorBody);
  });

  it('returns 504 when the upstream call times out', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError);
    const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req, fetchImpl);
    expect(res.status).toBe(504);
  });

  it('returns 502 when the upstream call fails for a non-timeout reason', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': uniqueIp() } });
    const res = await handleClaudeProxyRequest(req, fetchImpl);
    expect(res.status).toBe(502);
  });

  it(
    "preserves the current client's own request history through a bounded eviction instead of " +
      'wiping the whole map (CodeRabbit, CWE-770, PR #301)',
    async () => {
      // QNBS-v3: a fresh Response per call — a Response body can only be read once, and this mock
      // is invoked thousands of times, unlike the single-shot mockResolvedValue used elsewhere.
      const fetchImpl = vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
        );

      // QNBS-v3: exactly RATE_LIMIT_MAX_TRACKED_CLIENTS (5000) distinct spoofed clients fills the
      // map to the eviction threshold (> 5000, not >=) without tripping it yet.
      for (let i = 0; i < 5000; i++) {
        const spoofedIp = `10.${Math.floor(i / 65025)}.${Math.floor(i / 255) % 255}.${i % 255}`;
        const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': spoofedIp } });
        await handleClaudeProxyRequest(req, fetchImpl);
      }

      // QNBS-v3: the attacker's own 21 requests each push the map past the threshold (it never
      // drains below 5000, since the attacker's own key already exists after the first call), so
      // every one of these calls re-runs the eviction path with the attacker as the *current*
      // client — exactly the condition the old `.clear()` bug mishandled, since it wiped the
      // current caller's own just-recorded entry along with everyone else's.
      const attackerIp = '198.51.100.1';
      let lastRes: Response | undefined;
      for (let i = 0; i < 21; i++) {
        const req = makeRequest(validBody(), { headers: { 'x-forwarded-for': attackerIp } });
        lastRes = await handleClaudeProxyRequest(req, fetchImpl);
      }
      // QNBS-v3: the 21st request must still trip the limit — proving the attacker's own history
      // survived 20 rounds of eviction pressure instead of being reset by it.
      expect(lastRes?.status).toBe(429);
    },
  );
});
