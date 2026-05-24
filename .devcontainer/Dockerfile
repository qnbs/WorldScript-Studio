# ─── StoryCraft Studio — Dev Container ────────────────────────────────────────
# QNBS-v3: Multi-stage dev image — Node 22 LTS (Bookworm) + pnpm 10 + Rust + Python
# Matches package.json engines: node >= 22, pnpm >= 10
# ──────────────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/devcontainers/base:bookworm

# ─── System packages ──────────────────────────────────────────────────────────
# QNBS-v3: Playwright needs Chromium system deps; graphify needs Python 3 + pip;
# Tauri needs webkit2gtk + Rust toolchain. Install all in one layer to minimise
# image size and avoid duplicate apt-get update runs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
    libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2t64 libxshmfence1 \
    # Tauri / webkit2gtk dependencies
    libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 \
    librsvg2-dev libsoup-3.0-0 \
    # Build essentials
    build-essential pkg-config curl wget file \
    # Python for graphify
    python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# ─── Node.js 22 LTS ───────────────────────────────────────────────────────────
# QNBS-v3: Install Node 22 LTS explicitly (not 24 which is not LTS yet).
# Using nodesource to get a precise version matching package.json engines.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && node --version && npm --version

# ─── pnpm via corepack ────────────────────────────────────────────────────────
# QNBS-v3: corepack is the canonical way to activate pnpm matching packageManager.
# The prepare step pins the exact version from package.json.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && pnpm --version

# ─── Rust toolchain (for Tauri) ───────────────────────────────────────────────
# QNBS-v3: Install Rust via rustup — needed for `pnpm run tauri:dev` / `tauri build`.
# rustup default is stable; matches src-tauri/Cargo.toml rust-version = "1.77.2".
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    --default-toolchain stable --profile minimal \
  && rustup --version && cargo --version && rustc --version

# ─── Playwright browsers ──────────────────────────────────────────────────────
# QNBS-v3: Pre-install Chromium only (matches playwright.config.ts projects).
# Installed system-wide so every user gets it; avoids per-install download.
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/playwright
RUN npx playwright install --with-deps chromium \
  && npx playwright install-deps chromium

# ─── Python packages (graphify) ──────────────────────────────────────────────
# QNBS-v3: graphifyy is the PyPI package for the knowledge graph tool.
RUN python3 -m pip install --break-system-packages graphifyy \
  && graphify --version || true

# ─── Non-root user setup ─────────────────────────────────────────────────────
# The base image already creates a "vscode" user (UID 1000).
# Ensure cargo & rustup dirs are owned by vscode for non-root builds.
RUN chown -R vscode:vscode ${RUSTUP_HOME} ${CARGO_HOME} ${PLAYWRIGHT_BROWSERS_PATH}

# ─── Shell enhancements ──────────────────────────────────────────────────────
# QNBS-v3: Starship prompt + fzf + zoxide for fast navigation in the container.
RUN curl -fsSL https://starship.rs/install.sh | sh -s -- -y \
  && curl -fsSL https://github.com/junegunn/fzf/releases/download/0.56.3/fzf-0.56.3-linux_amd64.tar.gz \
    | tar xz -C /usr/local/bin \
  && curl -fsSL https://github.com/ajeetdsouza/zoxide/releases/download/v0.9.6/zoxide-v0.9.6-x86_64-unknown-linux-musl.tar.gz \
    | tar xz -C /usr/local/bin

# ─── Final working directory ──────────────────────────────────────────────────
WORKDIR /workspaces

# ─── Labels ───────────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="StoryCraft Studio Dev" \
      org.opencontainers.image.description="Full-featured dev environment for StoryCraft Studio" \
      org.opencontainers.image.source="https://github.com/qnbs/StoryCraft-Studio" \
      org.opencontainers.image.vendor="QNBS"
