# WorldScript Studio — Completed Tasks (v1.25.0 Providers Cycle)

Archived from `TODO.md` on 2026-07-31. These items were completed during the v1.25.0 release cycle
(native Grok/Claude cloud providers, opt-in Browser-Ollama, DuckDB excerpt encryption).

For the **current** task tracker see [`TODO.md`](../../TODO.md); for long-term planning see
[`ROADMAP.md`](../../ROADMAP.md).

---

## Native Grok + Claude + Ollama-in-PWA providers (2026-07-30)

README documented Grok and Claude as working cloud AI providers; neither was reachable from
`AiProviderCard.tsx`'s main flow. Full details + rationale in
[ADR-0016](../adr/0016-native-grok-and-claude-providers.md) and
[ADR-0017](../adr/0017-pwa-browser-ollama-opt-in.md); see `[1.25.0]` in
[CHANGELOG.md](../../CHANGELOG.md) for the user-facing summary. Execution plan:
[`GROK-PROVIDER-INTEGRATION-PLAN.md`](../../GROK-PROVIDER-INTEGRATION-PLAN.md).

- ✅ **Phase 1 — Grok**: wired into the primary provider dropdown + `providerFactory.ts`; the
  backend (`streamGrok()`) already worked, this was purely a UI/wiring gap.
- ✅ **Phase 2 Track A — Claude on desktop**: `streamAnthropic()` now branches on
  `isTauriRuntime()` before throwing; desktop calls Anthropic directly via the native-HTTP pattern
  ADR-0012 established for Ollama.
- ✅ **Phase 2 Track B — Claude on web/PWA**: new stateless serverless proxy
  (`api/claude-proxy.ts` + `functions/api/claude-proxy.ts`, Vercel + Cloudflare Pages) — this app's
  first backend dependency. Mandatory abuse controls (schema validation, body-size cap, origin
  check, rate limit, timeouts), never logs secrets. GitHub Pages shows an honest unavailable state.
- ✅ **Addendum — Ollama-in-PWA opt-in (Issue #266 follow-up)**: `enableBrowserOllama` flag
  (default off) lets the browser attempt a direct Ollama connection when the user has separately
  configured their own server's `OLLAMA_ORIGINS`; not a proxy, not a bypass, not the default.
- ✅ **DuckDB `codex_mentions.excerpt` cell-level encryption (SEC-6)** — the one analytics column
  holding literal manuscript prose is now AES-256-GCM encrypted into `excerpt_enc BLOB` when
  `enableIdbAtRestEncryption` is active, with a backfill migration
  (`services/duckdb/codexExcerptEncryptionMigration.ts`) for pre-existing plaintext rows.
- ✅ Doc-truth cleanup: `GROK-PROVIDER-INTEGRATION-PLAN.md` status header corrected;
  `.github/SECURITY.md` / `docs/SECURITY-THREAT-MODEL.md` SEC-6 status corrected; Claude-proxy
  monitoring recommendation (platform-native dashboards, doc-only) added.
- ✅ Release cut to `v1.25.0`: `CHANGELOG.md` dated, `package.json`/`README.md` version bumped,
  `src-tauri`/`public/sw.js` versions synced.
