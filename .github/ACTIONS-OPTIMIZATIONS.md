# GitHub Actions — Optimierungs-Historie

> **Stand Hinweis (2026-05):** Die nachfolgende Tabelle und Detailabschnitte beschreiben eine **Optimierungs-Runde und Zielgrößen**. Die **aktuell gültige** Job-Struktur, Trigger und Tooling sind in [**`docs/CI.md`**](../docs/CI.md) und [`.github/workflows/ci.yml`](./workflows/ci.yml) dokumentiert. Abweichungen (z. B. fehlende `tauri`-/`build-node`-Jobs im Haupt-Workflow) sind normal, sobald die Pipeline weiter vereinfacht wurde.

## Ziel

Dokumentation einer Audit-Runde für `.github/workflows/ci.yml` und zugehörige Komponenten: Berechtigungen, Caching, Artefakte, Timeouts und Secret-Nutzung.

## Übersichtstabelle (historische Zielwerte)

| Job          | Richtung                                             | Notizen                                                                      |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Quality gate | Lint + Typecheck + Tests in einem Job, Node-Matrix   | Heute: Job-ID `quality` (Biome + `tsc` + Vitest)                             |
| `security`   | `pnpm audit` + Dependency Review (PRs)             | Läuft vor dem Quality-Gate                                                   |
| `build`      | Vite Production + Artefakt                           | Pages-Upload nur auf `main`                                                  |
| `e2e`        | Playwright parallel zu weiteren Jobs nach Quality    | Deploy hängt von `build` + `e2e` ab                                          |
| `lighthouse` | Budgets nach erfolgreichem Build                     | Konfiguration: `.lighthouserc.cjs`                                           |
| `storybook`  | Statischer Build als Artefakt                        |                                                                              |
| `deploy`     | GitHub Pages                                         | `pages: write` nur im Deploy-Job                                             |

## Permissions (Leitprinzip)

- Standard: minimal `contents: read`
- Deploy: zusätzlich `pages: write` und `id-token` wo für OIDC nötig

## Secrets

- Codecov: optional über `CODECOV_TOKEN`
- Lighthouse GitHub App: optional `LHCI_GITHUB_APP_TOKEN` für erweiterte Integration

## Weitere Referenz

- [`docs/CI.md`](../docs/CI.md) — aktuelle Pipeline-Beschreibung (englisch, CI-parity-fokussiert)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — lokale Entwicklung und Qualitätskommandos
