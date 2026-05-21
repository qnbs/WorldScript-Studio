# Daily Driver — Low-End Local CI/CD

Praktische Checkliste für Ubuntu 20.04 Mate (2–4 GB RAM). **Primär lokal**; GitHub = Backup.

---

## Morgens / vor der Arbeit

- [ ] `sc-status` oder `ci-status.sh` — RAM/Swap prüfen
- [ ] Forgejo **nur** wenn du push/pull zum lokalen Remote brauchst: `sc-eco-on`
- [ ] Sonst Forgejo **aus**: `sc-eco-off`

---

## Während der Entwicklung (Standard, **ohne Docker**)

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm run ci:quick              # lint + i18n + typecheck
pnpm run ci:quick:unit         # + Vitest ohne Coverage
```

Einzelne Tests:

```bash
pnpm exec vitest run tests/unit/duckdbClient.test.ts
```

**DuckDB-WASM** läuft in Vitest (jsdom, `maxWorkers: 1`) — nicht parallel zu `act` starten.

---

## Vor Commit / Push (Forgejo)

```bash
pnpm run ci:quick:unit         # empfohlen
git add … && git commit -m "…"
git push forgejo main          # primäres Remote
```

Gelegentlich GitHub-Backup:

```bash
sc-mirror-gh                   # alias: push-to-github
```

---

## Volle CI-Nähe mit act (on-demand, **abends / vor Release**)

Voraussetzungen:

- [ ] Swap aktiv (`free -h`)
- [ ] `sc-eco-off` (Forgejo stoppen)
- [ ] Kein anderes schweres Programm

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm run ci:act
# oder schlanker E2E:
ci-act-sequential.sh pull_request --e2e-chromium-only
```

### Einzelne Jobs manuell

```bash
act pull_request -j security -W .github/workflows/ci.yml
act pull_request -j quality --matrix node-version:lts/* -W .github/workflows/ci.yml
act pull_request -j build -W .github/workflows/ci.yml
act pull_request -j e2e -W .github/workflows/ci.yml
act pull_request -j lighthouse -W .github/workflows/ci.yml
```

### Secrets

Datei: `~/storycraft-ci/act.secrets` (chmod 600)

```ini
GITHUB_TOKEN=ghp_…       # Mirror / API
CODECOV_TOKEN=           # optional
LHCI_GITHUB_APP_TOKEN=   # optional
```

Einzelnes Secret:

```bash
act pull_request -j quality -s CODECOV_TOKEN="$CODECOV_TOKEN"
```

### Jobs die lokal fehlen / anders sind

| Job | Lokal |
|-----|--------|
| `deploy` | Übersprungen (GitHub Pages) |
| `dependency-review` | Nur PR auf github.com |
| SLSA attest | Übersprungen |
| `gitleaks` / `osv-scanner` | Brauchen Netzwerk; bei OOM zuerst `security` einzeln testen |
| `mutation` | Optional `--with-mutation` (lang) |

### Matrix

Nur **eine** Node-Achse: `lts/*` (entspricht Node 22 im act-22.04-Image). Nicht beide Matrix-Zeilen parallel starten.

### Caching

- Host: `PNPM_STORE_DIR=~/storycraft-ci/cache/pnpm-store`
- act: Bind-Mount via `--bind` in `~/.actrc`
- Nach Lauf: `sc-eco-off` oder `low-end-optimization.sh --prune`

---

## Wöchentlich

- [ ] `pnpm run ci:act` mit `--with-storybook` (optional)
- [ ] `sc-backup`
- [ ] `systemctl --user start storycraft-ci-prune.timer` Status prüfen
- [ ] `git fetch github && sc-mirror-up` — Backup von GitHub holen falls du dort noch arbeitest

---

## Aliase (aus `bashrc-aliases.snippet`)

| Alias | Aktion |
|-------|--------|
| `sc-ci` | Quick-Tier |
| `sc-ci-unit` | Quick + Vitest |
| `sc-ci-cov` | Quick + Coverage |
| `sc-act` | act sequential (PR) |
| `sc-act-full` | act + storybook + chromium-only E2E |
| `sc-eco-on` / `sc-eco-off` | Forgejo start/stop + prune |
| `sc-status` | RAM, Docker, letztes act-Log |
| `sc-backup` | backup-ci.sh |
| `sc-mirror-gh` | Push main → GitHub |

---

## Monitoring (low-overhead)

```bash
sc-status
htop
tail -f ~/storycraft-ci/logs/act-*.log
docker compose -f infra/low-end-ci/docker-compose.forgejo.yml logs -f --tail=30
```

---

## Backup & Restore

```bash
sc-backup
ls ~/storycraft-ci/backups/
restore-ci.sh ~/storycraft-ci/backups/<timestamp>
```

---

## Troubleshooting Ubuntu 20.04 low-end

| Symptom | Ursache | Fix |
|---------|---------|-----|
| System friert ein | OOM | Swap 6G; `ci-eco-stop.sh --prune`; nur `ci:quick` tagsüber |
| act sehr langsam | HDD + Docker | Nachts laufen lassen; `pnpm` native für daily |
| `Cannot connect to Docker` | Daemon aus / Rechte | `sudo systemctl start docker`; in `docker` group |
| Vitest OOM | Coverage + WASM | Ohne `--coverage`; `NODE_OPTIONS=--max-old-space-size=1536` |
| Playwright OOM in act | 2 Browser-Projekte | `--e2e-chromium-only`; Swap |
| Forgejo 502 | Container bootet | `docker logs storycraft-forgejo`; RAM freigeben |
| act artifact fehlt lighthouse | Separater act-Lauf | Ein `act --sequential` mit build+e2e+lighthouse |
| gitleaks false positive | History scan | Secret rotieren; lokal Job überspringen wenn nötig |
| pnpm store korrupt | Abgebrochener install | `pnpm store prune` |

### Notfall-RAM freigeben

```bash
ci-eco-stop.sh --prune
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches   # kurz, Vorsicht
```

---

## Workflow-Übersicht

```text
Daily:     pnpm ci:quick → commit → push forgejo
Weekly:    pnpm ci:act → sc-backup → optional push github
Eco:       Forgejo nur bei git push/pull
```

---

Siehe auch: [docs/CI.md](../../docs/CI.md) · [INSTALL.md](INSTALL.md)
