# Daily Driver — Low-End Local CI/CD

Practical checklist for Ubuntu 20.04 Mate (2–4 GB RAM). **Primarily local**; GitHub = backup.

---

## Morning / before work

- [ ] `sc-status` or `ci-status.sh` — check RAM/swap
- [ ] Forgejo **only** if you need push/pull to the local remote: `sc-eco-on`
- [ ] Otherwise keep Forgejo **off**: `sc-eco-off`

---

## During development (standard, **without Docker**)

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm run ci:quick              # lint + i18n + typecheck
pnpm run ci:quick:unit         # + Vitest without coverage
```

Individual tests:

```bash
pnpm exec vitest run tests/unit/duckdbClient.test.ts
```

**DuckDB-WASM** runs in Vitest (jsdom, `maxWorkers: 1`) — do not start in parallel with `act`.

---

## Before commit / push (Forgejo)

```bash
pnpm run ci:quick:unit         # recommended
git add … && git commit -m "…"
git push forgejo main          # primary remote
```

Occasional GitHub backup:

```bash
sc-mirror-gh                   # alias: push-to-github
```

---

## Close CI parity with act (on-demand, **evenings / before release**)

Prerequisites:

- [ ] Swap active (`free -h`)
- [ ] `sc-eco-off` (stop Forgejo)
- [ ] No other heavy programs running

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm run ci:act
# or leaner E2E:
ci-act-sequential.sh pull_request --e2e-chromium-only
```

### Individual jobs manually

```bash
act pull_request -j security -W .github/workflows/ci.yml
act pull_request -j quality --matrix node-version:lts/* -W .github/workflows/ci.yml
act pull_request -j build -W .github/workflows/ci.yml
act pull_request -j e2e -W .github/workflows/ci.yml
act pull_request -j lighthouse -W .github/workflows/ci.yml
```

### Secrets

File: `~/storycraft-ci/act.secrets` (chmod 600)

```ini
GITHUB_TOKEN=ghp_…       # Mirror / API
CODECOV_TOKEN=           # optional
LHCI_GITHUB_APP_TOKEN=   # optional
```

Single secret:

```bash
act pull_request -j quality -s CODECOV_TOKEN="$CODECOV_TOKEN"
```

### Jobs missing locally / different behavior

| Job | Locally |
|-----|---------|
| `deploy` | Skipped (GitHub Pages) |
| `dependency-review` | PR on github.com only |
| SLSA attest | Skipped |
| `gitleaks` / `osv-scanner` | Need network; test `security` job alone first on OOM |
| `mutation` | Optional `--with-mutation` (slow) |

### Matrix

Only **one** Node axis: `lts/*` (corresponds to Node 22 in act-22.04 image). Do not run both matrix rows in parallel.

### Caching

- Host: `PNPM_STORE_DIR=~/storycraft-ci/cache/pnpm-store`
- act: bind-mount via `--bind` in `~/.actrc`
- After run: `sc-eco-off` or `low-end-optimization.sh --prune`

---

## Weekly

- [ ] `pnpm run ci:act` with `--with-storybook` (optional)
- [ ] `sc-backup`
- [ ] Check `systemctl --user start storycraft-ci-prune.timer` status
- [ ] `git fetch github && sc-mirror-up` — get backup from GitHub if you still work there

---

## Aliases (from `bashrc-aliases.snippet`)

| Alias | Action |
|-------|--------|
| `sc-ci` | Quick tier |
| `sc-ci-unit` | Quick + Vitest |
| `sc-ci-cov` | Quick + coverage |
| `sc-act` | act sequential (PR) |
| `sc-act-full` | act + storybook + Chromium-only E2E |
| `sc-eco-on` / `sc-eco-off` | Forgejo start/stop + prune |
| `sc-status` | RAM, Docker, last act log |
| `sc-backup` | backup-ci.sh |
| `sc-mirror-gh` | Push main → GitHub |

---

## Monitoring (low overhead)

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

| Symptom | Cause | Fix |
|---------|-------|-----|
| System freezes | OOM | Swap 6G; `ci-eco-stop.sh --prune`; only `ci:quick` during the day |
| act very slow | HDD + Docker | Run overnight; `pnpm` native for daily |
| `Cannot connect to Docker` | Daemon off / permissions | `sudo systemctl start docker`; in `docker` group |
| Vitest OOM | Coverage + WASM | Without `--coverage`; `NODE_OPTIONS=--max-old-space-size=1536` |
| Playwright OOM in act | 2 browser projects | `--e2e-chromium-only`; swap |
| Forgejo 502 | Container booting | `docker logs storycraft-forgejo`; free RAM |
| act artifact missing lighthouse | Separate act run | One `act --sequential` with build+e2e+lighthouse |
| gitleaks false positive | History scan | Rotate secret; skip job locally if needed |
| pnpm store corrupt | Aborted install | `pnpm store prune` |

### Emergency RAM release

```bash
ci-eco-stop.sh --prune
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches   # brief, use with caution
```

---

## Workflow overview

```text
Daily:     pnpm ci:quick → commit → push forgejo
Weekly:    pnpm ci:act → sc-backup → optional push github
Eco:       Forgejo only on git push/pull
```

---

See also: [docs/CI.md](../../docs/CI.md) · [INSTALL.md](INSTALL.md)
