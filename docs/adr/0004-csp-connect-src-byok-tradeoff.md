# ADR 0004 — CSP `connect-src` and the BYOK `https:` tradeoff

- **Status:** Accepted
- **Date:** 2026-06-10
- **Revised: 2026-07-28** — corrected a false Consequences claim (see below); no change to the Decision.
- **Deciders:** Maintainer + Claude Code
- **Context tags:** security, csp, networking, byok, tauri

## Context

The web PWA's `index.html` Content-Security-Policy `connect-src` directive contained both a
`https:` scheme-source **and** an explicit allowlist of cloud-provider endpoints
(`https://generativelanguage.googleapis.com`, `https://api.openai.com`, `https://api.x.ai`,
`https://api.groq.com`, `https://openrouter.ai`, `https://api.openrouter.ai`).

A scheme-source of `https:` matches **every** HTTPS origin. So the explicit per-provider entries
allowed *nothing the `https:` source did not already allow* — they were dead allowlist entries that
visually implied an egress hardening the policy did not actually provide. A 2026-06-09 audit (F-2)
flagged the explicit list, added in commit `364025e`, as functionally inert: the data-exfiltration
vector it appeared to close (an attacker forcing a `fetch` to an arbitrary HTTPS endpoint, e.g. via
AI prompt injection) remained open for all HTTPS targets.

The obvious "fix" — drop `https:` and keep only the explicit allowlist — **breaks a shipped
feature**. WorldScript ships **BYOK** (bring-your-own-key) with a user-configurable
`openAiCompatibleBaseUrl` (Settings → AI → custom base URL; see `features/settings/settingsSlice.ts`,
`components/settings/AiProviderCard.tsx`, `services/ai/worldScriptCompletionFetch.ts`,
`services/aiProviderService.ts`, `types.ts`). Users point the app at arbitrary self-hosted or
third-party OpenAI-compatible proxies. Those origins are user data — they cannot be statically
enumerated in a `<meta>` CSP shipped in the bundle. A strict allowlist would silently break every
user running a custom proxy.

The native **Tauri** build is different: `src-tauri/tauri.conf.json` already ships a strict
`connect-src` with no `https:` blanket (only the enumerated provider + localhost + wss origins).
The desktop app has OS-level egress controls and a narrower threat model, so the broad scheme is not
needed there.

## Decision

**Option B — keep `https:`, remove the redundant explicit cloud endpoints, document the tradeoff.**

- The web PWA `connect-src` keeps `'self' https:` plus the sources `https:` does **not** cover:
  `http://localhost|127.0.0.1` (Ollama :11434, LM Studio :1234, local AI :8000) and the explicit
  `wss://` Yjs signaling endpoints. No `http:` or `ws:` scheme-wildcards.
- The explicit `https://…` provider endpoints are removed — they are strictly redundant under
  `https:` and their presence misrepresented the policy's strength.
- The native **Tauri** `connect-src` stays strict (no `https:`). The asymmetry is intentional and
  documented: only the web PWA accepts the broad scheme, and only because of BYOK custom base URLs.
- A regression test (`tests/unit/csp.test.ts`) asserts the invariant: web CSP contains `https:` and
  no `http:`/`ws:` scheme-wildcards; Tauri CSP contains no `https:` blanket.

## Consequences

- **Positive:** the policy now states the truth — `https:` is the actual egress boundary, justified
  by a real shipped feature, instead of an allowlist that implied otherwise. Tauri keeps strict
  egress. `http:`/`ws:` scheme-wildcards remain disallowed, so cleartext exfiltration is still blocked.
- **Negative (accepted residual risk):** an attacker who can drive a `fetch` in the web PWA (e.g.
  successful AI prompt injection into a code path that issues a request) can reach any HTTPS origin.
  Mitigations: no secrets are placed in `connect-src`-reachable globals; API keys are encrypted at
  rest and only attached to the user-configured provider request; AI output is never `eval`'d
  (`CLAUDE.md` Key Constraints). Closing this fully requires build-time CSP generation from the
  provider registry + a validated custom-endpoint allowlist (Option C), deferred to v2.0.
- **Revision note (2026-07-28):** this section previously claimed "the host (Vercel/CF) tightens CSP
  further via HTTP response headers in production." That was **false** at the time it was written —
  none of `vercel.json`, `public/_headers`, or `nginx.conf` set a `Content-Security-Policy` header, so
  the accepted `connect-src` residual risk above had *no* documented compensating control. This has
  now been fixed: `vercel.json`, `public/_headers`, and `nginx.conf` all set a real `Content-Security-Policy`
  header, identical to the `index.html` meta CSP (`connect-src` is unchanged — this ADR's tradeoff still
  applies there — but `frame-ancestors 'none'` is only meaningful as a header, never as a meta tag, so
  that specific directive is a genuine new hardening on the three hosts that can set it).
  **GitHub Pages — the canonical upstream mirror — cannot set any HTTP response header at all** (no
  `_headers`-equivalent, no platform config surface); the `index.html` meta CSP is the *only*
  enforcement point there, and `Permissions-Policy` has no meta-tag equivalent at all, so it cannot be
  set on GitHub Pages under any circumstance. Any future claim in this ADR about host-level hardening
  must be checked against all four surfaces, not assumed.
- **Maintenance rule:** when adding a new **localhost** or **wss** endpoint, update **both**
  `index.html` and `src-tauri/tauri.conf.json`, and extend `tests/unit/csp.test.ts`. New **cloud
  HTTPS** providers need no `connect-src` change on web (covered by `https:`) but **do** need an
  explicit entry in the strict Tauri `connect-src`. **New header-origin or directive change:** update
  `vercel.json`, `public/_headers`, and `nginx.conf` together, plus `tests/unit/csp.test.ts` and
  `tests/unit/deploymentHeaders.test.ts` — a divergence between the header CSP and the meta CSP makes
  the meta tag misleading (see `docs/DEPLOYMENT.md` § Header invariants per host).

## Rejected alternatives

- **Option A — strict allowlist (drop `https:`):** breaks the shipped `openAiCompatibleBaseUrl` BYOK
  feature for every user running a self-hosted or alternate proxy. Rejected.
- **Option C — dynamic/build-time CSP generation** from the provider registry plus a
  settings-validated custom endpoint: the correct long-term fix but significant new build machinery;
  deferred to v2.0.
- **Keep the redundant explicit endpoints:** rejected — they change nothing under `https:` and
  misrepresent the policy.

## References

- `index.html` (web CSP meta), `src-tauri/tauri.conf.json` (native CSP)
- `tests/unit/csp.test.ts` (regression test)
- `docs/SECURITY-THREAT-MODEL.md` (web-vs-Tauri egress asymmetry)
- Audit 2026-06-09 finding F-2; commit `364025e`
- [[0002-local-ai-stack-layering]], [[0003-workerbus-hybrid-routing]]
