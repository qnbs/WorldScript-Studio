// QNBS-v3 (ADR-0016 Track B): Vercel Edge Function entry point. All abuse-control and relay logic
// lives in ./_shared/claudeProxyCore.ts (shared with the Cloudflare Pages equivalent in
// functions/api/claude-proxy.ts) — this file only adapts the platform's runtime config + handler shape.
// Edge (not Node) runtime: no new dependency (@vercel/node) needed, since the handler is written
// against the Web-standard Request/Response types already available via the "DOM" lib.
import { handleClaudeProxyRequest } from './_shared/claudeProxyCore';

export const config = { runtime: 'edge' };

export default function handler(request: Request): Promise<Response> {
  return handleClaudeProxyRequest(request);
}
