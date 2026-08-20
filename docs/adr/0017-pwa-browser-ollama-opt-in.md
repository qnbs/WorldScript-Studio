# ADR 0017 — Opt-in direct browser→Ollama connection in the web/PWA build

- **Status:** Accepted
- **Date:** 2026-07-30
- **Deciders:** Maintainer + Claude Code
- **Context tags:** ai, ollama, cors, pwa, feature-flag
- **Related:** [Issue #266](https://github.com/qnbs/WorldScript-Studio/issues/266) (comment thread,
  2026-07-28/29) · narrowly widens [ADR 0012](0012-local-server-connectivity-tauri-http.md) · see
  also [`GROK-PROVIDER-INTEGRATION-PLAN.md`](../history/GROK-PROVIDER-INTEGRATION-PLAN.md) §7 (the
  execution plan this ADR formalizes)

## Context

ADR-0012 made the PWA "strictly desktop-only" for local servers: the web build performs **zero**
localhost requests, by construction, for Ollama/LM Studio/vLLM discovery and connection testing.
That was the right default — auto-probing `localhost` from every settings visit produced console
noise for the overwhelming majority of users who never configured their server for it — but it was
never a technical dead end, and Issue #266's own comment thread already worked out why: **CORS is a
property of the *server's own configuration*, not an immutable browser wall.** If a user starts
their own Ollama server with `OLLAMA_ORIGINS` covering the PWA's exact origin, a direct browser
`fetch()` to `http://localhost:11434` succeeds — this is real, standards-compliant CORS, not a
bypass, and it's exactly how NovelCrafter's own browser-Ollama support works (their docs tell users
to run `OLLAMA_ORIGINS=https://app.novelcrafter.com ollama serve`).

**Why WorldScript never defaulted this on, unlike NovelCrafter:** NovelCrafter is a single-origin
SaaS product — one fixed URL to document. WorldScript Studio ships from **multiple possible
origins** (`qnbs.github.io`, `worldscript-studio.vercel.app`, custom domains, any fork's own Pages
URL), so there is no one `OLLAMA_ORIGINS` value to put in a static doc, and guessing wrong is worse
than not offering it. That's an argument against making it the *default*, not against offering it
as an explicit, informed, per-user opt-in — which is what this ADR adds.

**This is not the Claude proxy pattern (ADR-0016 Track B), and deliberately not designed as one.** A
serverless proxy's *destination* has to be a fixed host reachable from the public internet — that's
true for `api.anthropic.com`, never true for a user's own `localhost:11434`. A hosted function
fetching `localhost` reaches *itself*, never the user's machine. There is no proxy design that
bridges "an internet server reaching into a private machine" — this is a hard networking fact. So
this ADR adds a *client-side* opt-in, not a backend.

## Decision

1. **New feature flag `enableBrowserOllama`**, default **off**, added through the normal
   `featureFlagsSlice.ts` + `featureCatalog.ts` process (tier `ai`, risk `medium` — matches
   `enableVoiceSupport`'s classification for a similarly-scoped, non-destructive opt-in).
2. **No change to `services/localServerHttp.ts`'s transport layer.** Verified during
   implementation: `resolveFetch()` already returns `globalThis.fetch` unconditionally on the web —
   it never blocked browser requests at the network layer. The actual "PWA stays desktop-only"
   enforcement lived entirely in the *call sites* (the UI's auto-probe effect and
   `testAIConnection`'s hard `isTauriRuntime()` gate), which is where this flag's widening applies
   instead. This is narrower than the originating plan draft assumed — corrected here against the
   actual code, per this sprint's established re-verification discipline.
3. **`services/aiProviderService.ts`'s `testAIConnection`, `case 'ollama'`:** the gate becomes
   `isTauriRuntime() || opts.browserOllamaEnabled` instead of a hard desktop requirement. On a
   result, a plain `'unreachable'` kind is remapped to a new `'corsSuspected'` kind when running in
   the browser with the flag on.
4. **`components/settings/AiProviderCard.tsx`:** a derived `canAttemptOllama = isDesktop ||
   browserOllamaEnabled` replaces every bare `isDesktop` check that gated the ollama auto-probe
   effect, the "Load Models" button, and the "Test Connection" button. When the flag is on and the
   platform is web, the existing "desktop app required" warning is replaced by an info block that
   renders the exact `OLLAMA_ORIGINS=<window.location.origin> ollama serve` command for the
   *current* deployment — computed at render time, never a guessed/generic value, so the copy-paste
   instruction is always correct regardless of which of WorldScript's multiple possible origins is
   actually serving the page. The flag itself is toggled through the standard Settings →
   Experimental catalog UI (`FeatureFlagsSection.tsx`, generic for all flags) — no separate toggle
   was added to `AiProviderCard.tsx`.
5. **Error classification is a heuristic, honestly hedged, not a certain diagnosis.** The Fetch API
   gives an identical generic failure (`TypeError: Failed to fetch`) for a CORS rejection and for
   "the server genuinely isn't running" — there is no way to distinguish them at the JS level. The
   `'corsSuspected'` message says exactly that: verify `OLLAMA_ORIGINS` includes this origin, *or*
   check the server is running.
6. **Scope: Ollama only**, in this first pass. LM Studio's and vLLM's own CORS toggles are
   per-product settings, not a single env var — generalizing this to the existing
   `scanLocalOpenAiCompatibleEndpoints()` multi-server scan is explicitly deferred, not done here.
7. **Explicit non-goals** (all already rejected by ADR-0012's own "Alternatives considered", and not
   reopened by this ADR): no LAN-IP server support, no Private-Network-Access permission-prompt
   flow, no attempt to make this the default or to weaken/remove the existing desktop-first
   messaging — desktop remains the recommended, zero-config path.

## Consequences

- **Positive:** users who understand the tradeoff and are willing to configure their own server get
  a genuine, standards-compliant path to local inference from the PWA — closing the literal reading
  of "technically: yes" from Issue #266's own analysis. Zero behavior change for the default-off
  majority: the flag ships off, so nothing about today's desktop-first UX moves.
- **Negative (accepted):** the opt-in surfaces a new, unavoidably imprecise error state
  (`corsSuspected`) — a genuine UX tradeoff of offering a capability whose failure mode is
  fundamentally ambiguous at the JS layer. Documented plainly in the UI copy rather than overclaimed.
- **Not a reversal of ADR-0012:** the default behavior, the desktop-first framing, and the "PWA
  performs zero localhost requests by default" guarantee are all unchanged. This ADR narrowly widens
  ADR-0012's decision #4 for the specific case of an informed, explicit opt-in.

## References

- [Issue #266](https://github.com/qnbs/WorldScript-Studio/issues/266) — origin of both ADR-0012's
  native-HTTP pattern and this opt-in follow-up; the "technically: yes" analysis this ADR implements
- [[0012-local-server-connectivity-tauri-http]] — the desktop-only default this ADR narrowly widens
- [[0016-native-grok-and-claude-providers]] — why the same proxy pattern does *not* transfer here
  (§ Context above)
- [`GROK-PROVIDER-INTEGRATION-PLAN.md`](../history/GROK-PROVIDER-INTEGRATION-PLAN.md) §7 — full addendum
  this ADR formalizes
