# Installation — Low-End Local CI/CD (Ubuntu 20.04 Mate)

Ziel: **GitHub nur noch Backup**; tägliche Arbeit mit **nativem pnpm Quick-Tier**; volle Nähe zu [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) via **[act](https://github.com/nektos/act)**; optionales **Forgejo** als lokales Git-Remote (Eco-Mode, nicht 24/7).

**Hardware-Ziel:** 2–4 GB RAM, HDD, ältere CPU — mindestens **6 GB Swap** empfohlen.

> **Ubuntu 20.04 ist EOL (April 2025).** Diese Anleitung bleibt realistisch für deinen Laptop; mittelfristig Upgrade auf **22.04 LTS** empfohlen.

---

## Phase 0 — Baseline evaluieren

```bash
cd ~/githubcursor/StoryCraft-Studio/infra/low-end-ci
./scripts/install-permissions.sh
./eval-template.sh
```

Ergebnis: `~/storycraft-ci/eval-YYYY-MM-DD.txt`

---

## Phase 1 — System-Basis

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git jq ufw fail2ban htop ca-certificates gnupg lsb-release
```

### Swap (6 GB — bei <10 GB freiem Platz auf `/` anpassen)

```bash
sudo fallocate -l 6G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=6144 status=progress
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### sysctl (weniger aggressives Swappen)

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
# Forgejo nur lokal — kein ufw allow 3000 nötig
sudo ufw enable
```

---

## Phase 2 — Docker CE (24.x) auf Ubuntu 20.04

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

**daemon.json** (merge wenn Datei existiert):

```bash
sudo cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/config/docker-daemon.json.example /etc/docker/daemon.json
sudo systemctl restart docker
```

**cgroup v1 (Kernel 5.4):** Kein `cgroupns` erzwingen. Resource-Limits über Compose `deploy.resources` (siehe `docker-compose.forgejo.yml`).

---

## Phase 3 — Node 22 + pnpm (fnm, nicht apt)

```bash
curl -fsSL https://fnm.vercel.app/install | bash
# Shell neu laden, dann:
fnm install 22
fnm default 22
corepack enable
cd ~/githubcursor/StoryCraft-Studio
corepack prepare pnpm@10.33.0 --activate
node -v   # v22.x
pnpm -v
```

Persistenter pnpm-Store:

```bash
mkdir -p ~/storycraft-ci/cache/pnpm-store
pnpm config set store-dir ~/storycraft-ci/cache/pnpm-store
```

---

## Phase 4 — act

```bash
# Option A: GitHub Release (empfohlen auf 20.04)
ARCH="$(uname -m)"; VER="0.2.76"
curl -sSL "https://github.com/nektos/act/releases/download/v${VER}/act_Linux_${ARCH/x86_64/amd64}.tar.gz" | sudo tar xz -C /usr/local/bin act
act --version

# Option B: npm global (falls curl fehlschlägt)
# npm install -g act
```

### act-Konfiguration

```bash
mkdir -p ~/storycraft-ci/cache/act/artifacts ~/storycraft-ci/logs
cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/.actrc.example ~/.actrc
cp ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/act.secrets.example ~/storycraft-ci/act.secrets
chmod 600 ~/storycraft-ci/act.secrets
```

Erstes Image laden (einmalig, ~1–2 GB):

```bash
docker pull catthehacker/ubuntu:act-22.04
```

---

## Phase 5 — Verzeichnislayout

```bash
mkdir -p ~/storycraft-ci/{cache/pnpm-store,cache/act/artifacts,logs,backups,forgejo/data,forgejo/config}
```

---

## Phase 6 — Forgejo (Eco-Mode)

```bash
cd ~/githubcursor/StoryCraft-Studio/infra/low-end-ci
docker compose -f docker-compose.forgejo.yml up -d
```

Browser: **http://127.0.0.1:3000** — Admin anlegen, Registrierung ist deaktiviert.

Repository anlegen (UI), dann:

```bash
cd ~/githubcursor/StoryCraft-Studio
git remote add forgejo "http://127.0.0.1:3000/<DEIN_USER>/StoryCraft-Studio.git"
git remote add github "git@github.com:qnbs/StoryCraft-Studio.git"
git push -u forgejo main
```

**Eco:** Nach Arbeit `ci-eco-stop.sh` — Forgejo nicht dauerhaft laufen lassen auf 2 GB RAM.

### systemd (optional, User-Units)

```bash
./scripts/install-systemd-units.sh
systemctl --user enable --now storycraft-ci-prune.timer   # wöchentlich Docker prune
# Optional Backup zu GitHub nachts:
# systemctl --user enable --now storycraft-mirror.timer
```

Passe in `install-systemd-units.sh` generierte Pfade an, falls dein Repo **nicht** unter `~/githubcursor/StoryCraft-Studio` liegt.

---

## Phase 7 — Shell-Aliase

```bash
cat ~/githubcursor/StoryCraft-Studio/infra/low-end-ci/bashrc-aliases.snippet >> ~/.bashrc
source ~/.bashrc
```

---

## Phase 8 — Repo-Integration testen

```bash
cd ~/githubcursor/StoryCraft-Studio
pnpm install --frozen-lockfile
pnpm run ci:quick          # natives Quick-Tier
# Volle Workflow-Nähe (lang, braucht Swap):
pnpm run ci:act              # act sequential
```

---

## Backup

```bash
backup-ci.sh
# Wiederherstellen:
restore-ci.sh ~/storycraft-ci/backups/<timestamp>
```

---

## Rollback

1. `ci-eco-stop.sh --prune`
2. `docker compose -f infra/low-end-ci/docker-compose.forgejo.yml down`
3. Optional: `restore-ci.sh` aus Backup
4. Git-Remotes: `git remote remove forgejo` — nur **github** behalten
5. `sudo rm /etc/sysctl.d/99-storycraft-lowend.conf && sudo sysctl --system`
6. Swap-Datei kann bleiben (`swapoff` + fstab-Eintrag entfernen optional)
7. `~/.actrc` und `~/storycraft-ci` löschen wenn komplett zurück zu Cloud-only

---

## Typische Probleme (Installation)

| Problem | Fix |
|---------|-----|
| Docker permission denied | `sudo usermod -aG docker $USER` + neu einloggen |
| act: exec format error | Falsches Arch — Release `amd64` vs `arm64` prüfen |
| OOM während act | Swap ≥6G, `ci-eco-stop.sh`, nur `--sequential`, Matrix einachsig |
| Forgejo startet nicht | `docker logs storycraft-forgejo`; Datenverzeichnis-Rechte `chown 1000:1000` |
| Node zu alt | `fnm use 22` — Projekt verlangt Node ≥22 |

---

**Nächster Schritt:** [DAILY-DRIVER.md](DAILY-DRIVER.md)
