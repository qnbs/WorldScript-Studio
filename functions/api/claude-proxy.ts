// QNBS-v3 (ADR-0016 Track B): Cloudflare Pages Function entry point, at functions/api/claude-proxy.ts
// so its route (/api/claude-proxy) matches the Vercel Edge Function's (api/claude-proxy.ts) exactly
// — Cloudflare Pages routes a Function by its path *relative to functions/*, with no automatic
// "/api" prefix, unlike some other platforms' conventions. All abuse-control and relay logic lives
// in ../../api/_shared/claudeProxyCore.ts (shared with the Vercel entry point) — this file only
// adapts Cloudflare's `onRequest`/context handler shape. Typed by hand against the documented
// Cloudflare Pages Functions context shape rather than the `@cloudflare/workers-types` package, to
// avoid adding a new dependency for a single structural type.
import { handleClaudeProxyRequest } from '../../api/_shared/claudeProxyCore';

interface CloudflarePagesContext {
  request: Request;
}

export function onRequest(context: CloudflarePagesContext): Promise<Response> {
  return handleClaudeProxyRequest(context.request);
}
