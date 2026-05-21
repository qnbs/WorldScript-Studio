# Repository housekeeping

## GitHub “Languages” bar

GitHub uses [Linguist](https://github.com/github-linguist/linguist) on tracked files. A **~50 % HTML** share usually meant `graphify-out/graph.html` (~2.5 MB) was committed. **Solo policy (v1.10+):** that file is **gitignored**; only `graphify-out/GRAPH_REPORT.md` stays in git. Regenerate the full graph locally with `pnpm run graphify:update`.

**The app stack is TypeScript/React + Rust/Tauri**, not HTML. `.gitattributes` marks generated and docs paths so Linguist reports source languages more accurately:

| Path | Attribute |
|------|-----------|
| `graphify-out/GRAPH_REPORT.md` | `linguist-documentation` |
| `public/locales/**/bundle.json` | `linguist-generated` |
| `docs/**`, `*.md` | `linguist-documentation` |
| `*.ts`, `*.tsx` | TypeScript |
| `src-tauri/**` | Rust |

After merging `.gitattributes`, refresh the repo Languages bar on GitHub (can take a few minutes).

## Performance (solo)

`pnpm run graphify:update` scans the whole codebase and can use **several GB RAM** on large repos. It is **not** hooked into `pre-commit`. Run manually after big refactors, or set `GRAPHIFY_SKIP=1` to skip. Pre-commit only runs Biome on source files (not `public/locales/*/bundle.json` or `graphify-out/`).

## i18n runtime vs repo layout

- **Source of truth:** `locales/<lang>/*.json` (18 modules).
- **Runtime:** `public/locales/<lang>/bundle.json` only (built via `pnpm run i18n:bundle` / `prebuild`).
- Legacy per-module copies under `public/locales/` are **not** used by the app and are gitignored.

## Cold-start project titles (`initialProject.*`)

Project title/logline must never be stored as raw keys like `initialProject.title`. Fixes:

1. `services/i18nBootstrap.ts` — synchronous strings until `bundle.json` loads.
2. `I18nContext.t()` — bootstrap fallback before returning the key.
3. `services/projectI18nRepair.ts` — repairs persisted projects on load / language change.
