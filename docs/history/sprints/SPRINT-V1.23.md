# Sprint v1.23 — Stabilisation & Verification (SCOPING STUB)

**Status:** planned · **Target:** `v1.23.0` · **Created:** 2026-06-14

> Scoping only — no implementation. This stub bundles the remaining **real engineering**
> items left after the 2026-06-14 audit-correction pass (metric hygiene, token/suppression
> ratcheting, ADR/TODO governance — all merged). Source of truth for status stays `TODO.md`
> and `ROADMAP.md` (§ *v1.23 — Stabilisation & Verification*).

## Scope

| # | Area | Item | Notes / anchor |
|---|------|------|----------------|
| 1 | Coverage | Raise Vitest gate toward **L85 / B75 / F80** | Current thresholds L74/B60/F67/S72 (`vitest.config.ts`). Incremental — pick the lowest-covered services first; don't lower thresholds. |
| 2 | Voice E2E | Re-enable the **two `test.fixme`** STT→command navigation cases | `tests/e2e/deep/voice/whisper-stt.spec.ts`; headless mock-STT → push-to-talk → command-dispatch chain is flaky under fake-media. Trace the CI voice-init sequence first (TODO P1-2 follow-up b). |
| 3 | Release QA | Run the **manual cross-platform sign-off matrix** | `docs/V1.22-SMOKE-TEST.md` — human-only step (Windows/macOS/Linux Tauri build + live demo). Record results in the matrix. |
| 4 | Deps | **joi / wait-on** housekeeping → drive `pnpm audit` high → moderate | Add/refresh `pnpm.overrides`; document accepted risk in `AUDIT.md`. |
| 5 | Types (carry-over) | Reduce the remaining **33 `noExplicitAny`** suppressions | Mostly selector-mock assignability casts (RootState contravariance) — need a typed `mockSelector<T>` test helper rather than per-site `any`. Ratchet `suppressions-baseline.json` as they fall. |

## Validation (per item, before merge)

```bash
pnpm run typecheck && pnpm run lint
pnpm run i18n:check && node scripts/check-suppressions.mjs && node scripts/audit-tokens.mjs
pnpm run test:run          # full suite (CI gate on low-end hw)
pnpm run test:coverage     # items 1, 5
# item 2: CI e2e-deep job (RUN_REAL_VOICE_E2E nightly for real inference)
```

## Out of scope

- Feature work and architecture changes (none planned for v1.23).
- v2.0 foundation items (Cloud-Sync conflict resolution, Plugin Registry Beta) — see `TODO.md` P2-2..P2-4.
