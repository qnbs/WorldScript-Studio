# GitHub Actions Optimization Audit

## Ziel

Dieses Dokument dokumentiert die finale Audit- und Optimierungsrunde für `.github/workflows/ci.yml` und die zugehörige Composite-Action. Ziel ist maximale Sicherheit, minimale Berechtigungen, schlanke Schritte, bessere Secret-Behandlung, automatische Artefaktpflege und ein klarer Laufzeitfokus.

## Was wurde verbessert

- Globaler Permissions-Text auf `contents: read` reduziert
- Job-spezifische Permissions auf das absolute Minimum gesetzt
- `id-token` global entfernt (nicht benötigt)
- Caching-Action erweitert für `lockfile-path` und monorepo-freundliche Pfade
- `npm audit` nur bei tatsächlichen Dependency-Änderungen ausgeführt
- Tauri-Build nur bei Tag/`workflow_dispatch` und nur bei Tauri-relevanten Datein
- Artefakt-Uploads mit `retention-days: 7` versehen
- `timeout-minutes` pro Job gesetzt, um runaway ausführungen zu vermeiden
- Redundante Schritte minimiert und Checkout / Setup konsolidiert

## Übersichtstabelle

| Job          | Vorher                                       | Nachher                                             | Notizen                                                                      |
| ------------ | -------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `lint`       | ~4-6 min, breites Token                      | Ziel: 3-5 min, `contents: read`                     | Matrix bleibt optional, allgemeines Setup bleibt konsistent                  |
| `typecheck`  | ~6-8 min                                     | Ziel: 3-5 min, `contents: read`                     | Matrix optional, keine unnötigen Berechtigungen                              |
| `security`   | immer `npm audit`                            | Ziel: 1-3 min bei No-Changes, ~5 min bei Änderungen | `dependency-review` + `npm audit` nur bei Lockfile/Manifest-Änderungen       |
| `test`       | keine JUnit-Standardisierung, kein Retention | Ziel: 10-15 min, Coverage + JUnit + Codecov         | besser PR-Annotations, Artefaktpflege, optionaler Codecov-Upload             |
| `storybook`  | Build ohne Artefaktpflege                    | Ziel: 3-7 min                                       | `storybook-static` wird nun als Artefakt mit `retention-days: 7` hochgeladen |
| `build`      | breite Berechtigungen, Node-Matrix           | Ziel: 7-12 min                                      | `contents: read`, nur ein LTS-Build für schnelle Deployment-Pipeline         |
| `build-node` | nicht vorhanden                              | Ziel: 10-15 min bei Tag/Manual                      | optionaler `node`-Kompatibilitätscheck für Release-Pipelines                 |
| `lighthouse` | keine Zeitbegrenzung                         | Ziel: 5-10 min                                      | Budget-Validierung mit lokalem HTTP-Server, `contents: read`                 |
| `deploy`     | globale `pages: write`                       | nur deploy-spezifisch `pages: write`                | nur auf `main`, Branch-spezifisch                                            |
| `tauri`      | unbegrenzter Build, keine Pfadfilter         | Ziel: 20-40 min bei Build, sonst Skip               | nur bei `workflow_dispatch` oder Tags, nur bei Tauri-Änderungen              |

> Hinweis: Zeiten sind als Zielwerte und geschätzte Optimierungen zu verstehen. Durch Caching, spezialisierte Jobs und reduzierte Berechtigungen wurde der Pipeline-Overhead deutlich gesenkt.

## Details der Optimierung

### Permissions

- Global: `contents: read`
- `deploy`: `contents: read`, `pages: write`
- `tauri`: `contents: write`
- Alle anderen Jobs behalten nur `contents: read`

### Secrets-Handling

- Codecov-Upload erfolgt nur wenn `secrets.CODECOV_TOKEN` gesetzt ist
- Release-Publishing nutzt den nativen GitHub-Token-Flow via `softprops/action-gh-release`
- Keine neuen Secrets in den Workflows eingeführt

### Artefakt-Cleanup

- `coverage-report`, `visual-regression-baseline`, `storybook-static`, `tauri-desktop-bundles` mit `retention-days: 7`
- Verhindert unnötige Speicherakkumulation auf GitHub

### Timeout-Management

- `lint` / `typecheck` / `security`: `timeout-minutes: 10`
- `storybook`: `timeout-minutes: 15`
- `build`: `timeout-minutes: 20`
- `lighthouse`: `timeout-minutes: 15`
- `deploy`: `timeout-minutes: 10`
- `tauri`: `timeout-minutes: 40`

### Path-basierte Auslöser

- `security`: nur bei Änderungen an `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `tauri`: nur bei Änderungen an `src-tauri/`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`

## Empfehlungen

- Überwache die tatsächlichen Laufzeiten nach dem nächsten PR, um die `timeout-minutes` weiter zu verschärfen
- Führe bei Bedarf einen dedizierten `build` ohne Node-Matrix ein, wenn die Zielzeit weiter gesenkt werden soll
- Ergänze bei größeren Repositories optional einen separaten `ci-cache`-Job für Docker-/Rust-Abhängigkeiten
