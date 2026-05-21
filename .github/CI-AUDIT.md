# CI Audit — StoryCraft Studio

**Stand:** 2026-05-21 · **Workflow-Dateien:** 2 (`ci.yml`, `tauri-build.yml`) + Renovate

Dieses Dokument fasst die **Ist-Inventur** und die **Stabilisierungsmaßnahmen** der GitHub-Pipeline zusammen. Vollständige Job-Beschreibung: [`docs/CI.md`](../docs/CI.md).

---

## Workflow-Inventur

| Datei | Trigger | Kern-Jobs |
|-------|---------|-----------|
| [`workflows/ci.yml`](workflows/ci.yml) | `push`/`pull_request` **main**, Tags, `workflow_dispatch` | `security` → `quality` (Matrix) → `build` \| `e2e` \| `storybook` \| `mutation` → `lighthouse` → `deploy` (main) |
| [`workflows/tauri-build.yml`](workflows/tauri-build.yml) | `workflow_dispatch`, Tags `v*` | Desktop-Bundles (Linux/Win/macOS) |

**Nicht vorhanden (bewusst optional):** separate `codeql.yml`, `dependabot.yml` (stattdessen Renovate), MDC-Validierung in CI, Graphify-Doctor im Runner.

---

## Toolchain (Parität lokal ↔ CI)

| Thema | Quelle | Wert |
|-------|--------|------|
| Node (empfohlen) | [`.nvmrc`](../.nvmrc) | **22** |
| Node (CI-Matrix) | `ci.yml` `quality` | **22** und **24** (explizit, kein `node` = „current“) |
| pnpm | `package.json` `packageManager` | **10.33.0** |
| Lint | Biome | `pnpm run lint` |
| i18n | `scripts/check-i18n-keys.mjs` | `pnpm run i18n:check` |
| Unit | Vitest + V8 | `pnpm exec vitest run --coverage` |
| E2E | Playwright | `CI=true pnpm run test:e2e` |
| Bundle | `scripts/check-bundle-budget.mjs` | max **7000 KB** pro Chunk, max **4500 KB** Entry (`index-*.js`) |
| Lighthouse | `.lighthouserc.cjs` | Accessibility **error** ≥ 0.95; CLS **error** ≤ 0.1; Performance **warn** |

---

## Durchgeführte Stabilisierungen (Audit 2026-05)

| Problem | Fix |
|---------|-----|
| Matrix `node-version: ['lts/*', 'node']` bricht bei neuem Node-Release ohne Codeänderung | Auf **`['22', '24']`** gepinnt |
| Entry-Chunk wächst mit Plot-Board-Splits | Separates Budget **`--max-entry-kb 4500`** in `bundle:budget` |
| Vendor-Chunks (ML, DuckDB) | `manualChunks` + PWA `resolveDependencies`-Filter für `plot-board`, `vendor-duckdb`, `vendor-ai-onnx` |

---

## Lokale Reproduktion (Quick vs Heavy)

**Quick (Laptop, 2–4 GB RAM):**

```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
# optional: pnpm exec vitest run   # ohne --coverage
```

**Heavy (CI-Parität):**

```bash
pnpm install --frozen-lockfile
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
pnpm exec vitest run --coverage
pnpm run build && pnpm run bundle:budget
CI=true pnpm run test:e2e
# optional nach build: pnpm exec lhci autorun
```

**Low-End-Skripte:** [`infra/low-end-ci/`](../infra/low-end-ci/) (`pnpm run ci:quick`, `pnpm run ci:act`).

---

## Risiko-Register (offen / beobachten)

| Risiko | Mitigation |
|--------|------------|
| Lighthouse Performance `warn` — mobile Emulation instabil | Nur **warn**; CLS + A11y als **error** |
| E2E Flakes (SPA + Mobile-Projekt) | Retries 2, 1 Worker; bei Flake: Spec/Helper fixen, nicht global skippen |
| Tauri `ubuntu-22.04` vs 24.04 | Separater PR nach Paket-Check |
| Dynamische Vite `base` für Custom Domains | Produktentscheidung — nicht Teil des Baseline-CI-Fixes |

---

## Security-Jobs (bereits in `ci.yml`)

- `pnpm audit --audit-level=high`
- OSV-Scanner (`pnpm-lock.yaml` + `src-tauri/Cargo.lock`)
- gitleaks (History-Scan, `fetch-depth: 0`)
- PR: dependency-review-action
- OpenSSF Scorecard (eigener Job, weekly + main)

**Optional (nur auf explizite Anfrage):** dedizierter CodeQL-Workflow, SBOM-Attestation über Release-Tags.

---

## Nächste Schritte (Maintainer)

1. Nach größeren Features: `pnpm run graphify:update` (Repo-Policy, nicht in CI).
2. Nach grünem CI-Lauf: README-Badges und `AUDIT.md` Metriken aus Codecov/Logs aktualisieren.
3. Bei Bundle-Regression: `pnpm run analyze` → Artifact `bundle-analysis.html` in der CI-Run-Ansicht.
