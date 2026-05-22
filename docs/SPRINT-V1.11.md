# Sprint v1.11 — Stabilization: Deploy Fix, StorageBackend Resilience, Help Center Complete

**Release:** `v1.11.0` (2026-05-22)

## Goals

| Area | Outcome |
|------|---------|
| Cloudflare deploy | Fix `resolve-deploy-base.mjs` variable name bug (`base` → `deployBase`); `sync-deploy-base.mjs` error handling + `exit(1)` on patch failure |
| StorageBackend resilience | `initializeStorage()` + `resetAllDatabases()` extracted to `services/dbInitialization.ts`; `retryDb()` applied to `saveProject` + `saveSettings`; `StorageErrorScreen` recovery UI in `index.tsx`; settings auto-save errors now show toast |
| Help Center | All 13 stub articles (< 300 chars) fully written to 700–1000 chars across all 5 locales (de/en/es/fr/it); 1931 keys verified at parity |

## Key Files Changed

| File | Change |
|------|--------|
| `scripts/resolve-deploy-base.mjs:21` | `base` → `deployBase` (Cloudflare P0 fix) |
| `scripts/sync-deploy-base.mjs` | `const text` lint fix; error propagation |
| `services/dbInitialization.ts` | **NEW** — `initializeStorage()`, `resetAllDatabases()` |
| `services/dbService.ts` | `saveProject` + `saveSettings` wrapped in `retryDb()` |
| `index.tsx` | `StorageErrorScreen` recovery UI replaces raw red div |
| `app/listenerMiddleware.ts` | Settings auto-save catch → dispatch error toast |
| `locales/en/help.json` | 13 articles fully written (700–1000 chars HTML) |
| `locales/de/help.json` | 13 articles translated; German typographic quote fix (11 ASCII→U+201C) |
| `locales/es/help.json` | 13 articles translated |
| `locales/fr/help.json` | 13 articles translated |
| `locales/it/help.json` | 13 articles translated |
| `public/locales/*/bundle.json` | Rebuilt via `pnpm run i18n:bundle` |
| `tests/unit/dbInitialization.test.ts` | **NEW** — 8 tests |
| `tests/unit/dbServiceRetry.test.ts` | **NEW** — 7 tests |
| `App.tsx:337` | Remove redundant `language` dep from useEffect |

## Validation

```bash
pnpm run lint
pnpm run i18n:check     # 5 locales, 1931 keys each
pnpm run typecheck
pnpm exec vitest run tests/unit/dbInitialization.test.ts tests/unit/dbServiceRetry.test.ts
```

Results: lint ✅ · i18n ✅ (1931 keys × 5 locales) · typecheck ✅ · 15/15 tests ✅
