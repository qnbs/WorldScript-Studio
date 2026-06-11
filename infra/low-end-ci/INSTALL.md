# Installation — Low-End Local CI/CD (Ubuntu 20.04 Mate)

Goal: **GitHub is backup only**; daily work with **native pnpm quick tier**; full parity with [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) via **[act](https://github.com/nektos/act)**; optional **Forgejo** as local Git remote (eco mode, not 24/7).

**Hardware target:** 2–4 GB RAM, HDD, older CPU — at least **6 GB swap** recommended.

> **Ubuntu 20.04 is EOL (April 2025).** This guide remains realistic for your laptop; a medium-term upgrade to **22.04 LTS** is recommended.

---

## Phase 0 — Evaluate baseline

```bash
cd ~/githubcursor/StoryCraft-Studio/infra/low-end-ci
./scripts/install-permissions.sh
./eval-template.sh
```

Result: `~/storycraft-ci/eval-YYYY-MM-DD.txt`

---

## Phase 1 — System base

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git jq ufw fail2ban htop ca-certificates gnupg lsb-release
```

### Swap (6 GB — adjust if `/` has less than 10 GB free)

```bash
sudo fallocate -l 6G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=6144 status=progress
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### sysctl (less aggressive swapping)

```bash
sudo tee /etc/sysctl.d/99-storycraft-lowend.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sudo sysctl --system
```

### UFW (SSH + localhost Forgejo)

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
# Forgejo local only — no ufw allow 3000 needed
sudo ufw enable
```

---

## Phase 2 — Docker CE (24.x) on Ubuntu 20.04

```bash
sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu focal stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

**daemon.json** (merge if file already exists):

```bash
sudo cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/config/docker-daemon.json.example /etc/docker/daemon.json
sudo systemctl restart docker
```

**cgroup v1 (Kernel 5.4):** Do not force `cgroupns`. Resource limits via Compose `deploy.resources` (see `docker-compose.forgejo.yml`).

---

## Phase 3 — Node 22 + pnpm (fnm, not apt)

```bash
curl -fsSL https://fnm.vercel.app/install | bash
# Reload shell, then:
fnm install 22
fnm default 22
corepack enable
cd ~/githubcursor/StoryCraft-Studio
corepack prepare pnpm@11.5.2 --activate
node -v   # v22.x
pnpm -v
```

Persistent pnpm store:

```bash
mkdir -p ~/storycraft-ci/cache/pnpm-store
pnpm config set store-dir ~/storycraft-ci/cache/pnpm-store
```

---

## Phase 4 — act

```bash
# Option A: GitHub Release (recommended on 20.04)
ARCH="$(uname -m)"; VER="0.2.76"
curl -sSL "https://github.com/nektos/act/releases/download/v${VER}/act_Linux_${ARCH/x86_64/amd64}.tar.gz" | sudo tar xz -C /usr/local/bin act
act --version

# Option B: npm global (if curl fails)
# npm install -g act
```

### act configuration

```bash
mkdir -p ~/storycraft-ci/cache/act/artifacts ~/storycraft-ci/logs
cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/.actrc.example ~/.actrc
cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/act.secrets.example ~/storycraft-ci/act.secrets
chmod 600 ~/storycraft-ci/act.secrets
```

Load initial image (one-time, ~1–2 GB):

```bash
docker pull catthehacker/ubuntu:act-22.04
```

---

## Phase 5 — Directory layout

```bash
mkdir -p ~/storycraft-ci/{cache/pnpm-store,cache/act/artifacts,logs,backups,forgejo/data,forgejo/config}
```

---

## Phase 6 — Forgejo (eco mode)

```bash
cd ~/githubcursor/StoryCraft-Studio/infra/low-end-ci
docker compose -f docker-compose.forgejo.yml up -d
```

Browser: **http://127.0.0.1:3000** — create admin user; registration is disabled.

Create repository (UI), then:

```bash
cd ~/githubcursor/StoryCraft-Studio
git remote add forgejo "http://127.0.0.1:3000/<YOUR_USER>/StoryCraft-Studio.git"
git remote add github "git@github.com:qnbs/StoryCraft-Studio.git"
git push -u forgejo main
```

**Eco:** After work run `ci-eco-stop.sh` — do not keep Forgejo running continuously on 2 GB RAM.

### systemd (optional, user units)

```bash
./scripts/install-systemd-units.sh
systemctl --user enable --now storycraft-ci-prune.timer   # weekly Docker prune
# Optional nightly backup to GitHub:
# systemctl --user enable --now storycraft-mirror.timer
```

Adjust generated paths in `install-systemd-units.sh` if your repo is **not** located at `~/githubcursor/StoryCraft-Studio`.

---

## Phase 7 — Shell aliases

```bash
cat ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/bashrc-aliases.snippet >> ~/.bashrc
source ~/.bashrc
```

---

## Phase 8 — Test repo integration

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm install --frozen-lockfile
pnpm run ci:quick          # native quick tier
# Full workflow parity (slow, needs swap):
pnpm run ci:act              # act sequential
```

---

## Backup

```bash
backup-ci.sh
# Restore:
restore-ci.sh ~/storycraft-ci/backups/<timestamp>
```

---

## Rollback

1. `ci-eco-stop.sh --prune`
2. `docker compose -f infra/low-end-ci/docker-compose.forgejo.yml down`
3. Optional: `restore-ci.sh` from backup
4. Git remotes: `git remote remove forgejo` — keep only **github**
5. `sudo rm /etc/sysctl.d/99-storycraft-lowend.conf && sudo sysctl --system`
6. Swap file can remain (`swapoff` + remove fstab entry is optional)
7. Delete `~/.actrc` and `~/storycraft-ci` if going fully back to cloud-only

---

## Common problems (installation)

| Problem | Fix |
|---------|-----|
| Docker permission denied | `sudo usermod -aG docker $USER` + re-login |
| act: exec format error | Wrong arch — check release `amd64` vs `arm64` |
| OOM during act | Swap ≥6G, `ci-eco-stop.sh`, `--sequential` only, single-axis matrix |
| Forgejo won't start | `docker logs storycraft-forgejo`; data directory permissions `chown 1000:1000` |
| Node too old | `fnm use 22` — project requires Node ≥22 |

---

**Next step:** [DAILY-DRIVER.md](DAILY-DRIVER.md)
