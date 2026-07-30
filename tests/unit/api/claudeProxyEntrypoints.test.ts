import { describe, expect, it } from 'vitest';
import handler, { config } from '../../../api/claude-proxy';
import { onRequest } from '../../../functions/api/claude-proxy';

// QNBS-v3 (ADR-0016 Track B): both platform entry points are thin wrappers around the shared
// api/_shared/claudeProxyCore.ts relay (already covered exhaustively in claudeProxyCore.test.ts) —
// these tests only confirm each wrapper actually delegates to it, using the cheapest observable
// signal (a validation-failure request needs no network mocking to produce a real 400/403 response).

describe('api/claude-proxy.ts (Vercel Edge Function entry point)', () => {
  it('declares the edge runtime', () => {
    expect(config).toEqual({ runtime: 'edge' });
  });

  it('delegates to the shared relay core', async () => {
    const req = new Request('https://worldscript-studio.vercel.app/api/claude-proxy', {
      method: 'GET',
    });
    const res = await handler(req);
    expect(res.status).toBe(405);
  });
});

describe('functions/api/claude-proxy.ts (Cloudflare Pages Function entry point)', () => {
  it('delegates to the shared relay core', async () => {
    const req = new Request('https://worldscript-studio.pages.dev/api/claude-proxy', {
      method: 'GET',
    });
    const res = await onRequest({ request: req });
    expect(res.status).toBe(405);
  });
});
