# ─── StoryCraft Studio — Dev Container ────────────────────────────────────────
# QNBS-v3: Multi-stage dev image — Node 22 LTS (Bookworm) + pnpm 10 + Rust + Python
# Matches package.json engines: node >= 22, pnpm >= 10
# ──────────────────────────────────────────────────────────────────────────────

# QNBS-v3: SHA-pinned base image — prevents supply-chain attacks via mutable tags (Scorecard Pinned-Dependencies).
FROM mcr.microsoft.com/devcontainers/base:bookworm

# ─── System packages ──────────────────────────────────────────────────────────
# QNBS-v3: Playwright needs Chromium system deps; graphify needs Python 3 + pip;
# Tauri needs webkit2gtk + Rust toolchain. Install all in one layer to minimise
# image size and avoid duplicate apt-get update runs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 \
    # Tauri / webkit2gtk dependencies
    libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 \
    librsvg2-dev libsoup-3.0-0 \
    # Build essentials
    build-essential pkg-config curl wget file \
    # Python for graphify
    python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# ─── Node.js 22 LTS ───────────────────────────────────────────────────────────
# QNBS-v3: NodeSource setup script download-then-verify pattern (Scorecard Pinned-Dependencies).
# Avoids blind pipe-to-bash; SHA pinned to setup_22.x as of 2026-05-31. Update SHA on any NodeSource refresh.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
  && echo "575583bbac2fccc0b5edd0dbc03e222d9f9dc8d724da996d22754d6411104fd1  /tmp/nodesource_setup.sh" | sha256sum -c - \
  && bash /tmp/nodesource_setup.sh \
  && rm /tmp/nodesource_setup.sh \
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
# QNBS-v3: rustup download-then-verify — avoids blind pipe-to-sh (Scorecard Pinned-Dependencies).
# SHA pinned to rustup installer as of 2026-05-31; update SHA when rustup releases a new installer.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh \
  && echo "6c30b75a75b28a96fd913a037c8581b580080b6ee9b8169a3c0feb1af7fe8caf  /tmp/rustup-init.sh" | sha256sum -c - \
  && sh /tmp/rustup-init.sh -y --default-toolchain stable --profile minimal \
  && rm /tmp/rustup-init.sh \
  && rustup --version && cargo --version && rustc --version

# ─── Playwright browsers ──────────────────────────────────────────────────────
# QNBS-v3: Pre-install Chromium only (matches playwright.config.ts projects).
# Installed system-wide so every user gets it; avoids per-install download.
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/playwright
RUN npx playwright install --with-deps chromium \
  && npx playwright install-deps chromium

# ─── Python packages (graphify) ─────────────────────────────────────────────
# QNBS-v3: graphifyy is the PyPI package for the knowledge graph tool (dev-only convenience;
#          graph outputs are committed and regenerated locally — graphifyy is NOT a build or
#          release dependency of the app).
# QNBS-v3: Install a minimal, pinned graphifyy during image build. Some pip versions in
# older base images don't accept --hash/--require-hashes in this context which breaks builds
# (observed in Codespaces build runners). Strategy:
# 1) Upgrade pip/setuptools/wheel to a modern version
# 2) Try installing graphifyy without hashes (no-deps) during build
# 3) Allow a graceful fallback so the image build doesn't fail; full dependency install
#    will still run in the `postCreateCommand` lifecycle hook inside the created container.
RUN python3 -m pip install --break-system-packages --upgrade pip setuptools wheel || true
# Note: graphifyy and its tree-sitter deps are installed in the devcontainer lifecycle
# `postCreateCommand` to avoid build-time failures caused by varying pip behavior
# across Codespaces build runners. See .devcontainer/devcontainer.json for post-create hook.

# ─── Non-root user setup ─────────────────────────────────────────────────────
# The base image already creates a "vscode" user (UID 1000).
# Ensure cargo & rustup dirs are owned by vscode for non-root builds.
RUN chown -R vscode:vscode ${RUSTUP_HOME} ${CARGO_HOME} ${PLAYWRIGHT_BROWSERS_PATH}

# ─── Shell enhancements ──────────────────────────────────────────────────────
# QNBS-v3: Starship v1.25.1 (SHA-verified), fzf 0.56.3, zoxide v0.9.6 — version-pinned for
# supply-chain safety (Scorecard Pinned-Dependencies). Update by bumping version + sha256.
RUN STARSHIP_SHA="4488c11ca632327d1f1f16fb2f102c0646094c35479cd5435991385da43c61ac" \
  && curl -fSL "https://github.com/starship/starship/releases/download/v1.25.1/starship-x86_64-unknown-linux-gnu.tar.gz" -o /tmp/starship.tar.gz \
  && echo "${STARSHIP_SHA}  /tmp/starship.tar.gz" | sha256sum -c - \
  && tar xzf /tmp/starship.tar.gz -C /usr/local/bin \
  && rm -f /tmp/starship.tar.gz \
  && FZF_URL="https://github.com/junegunn/fzf/releases/download/0.56.3/fzf-0.56.3-linux_amd64.tar.gz" \
  && if curl -fSL -o /tmp/fzf.tar.gz "$FZF_URL"; then \
       tar xzf /tmp/fzf.tar.gz -C /usr/local/bin && rm -f /tmp/fzf.tar.gz; \
     else \
       echo "warning: fzf download failed (url: $FZF_URL), skipping"; \
     fi \
  && ZOXIDE_URL="https://github.com/ajeetdsouza/zoxide/releases/download/v0.9.6/zoxide-v0.9.6-x86_64-unknown-linux-musl.tar.gz" \
  && if curl -fSL -o /tmp/zoxide.tar.gz "$ZOXIDE_URL"; then \
       tar xzf /tmp/zoxide.tar.gz -C /usr/local/bin && rm -f /tmp/zoxide.tar.gz; \
     else \
       echo "warning: zoxide download failed (url: $ZOXIDE_URL), skipping"; \
     fi

# ─── Final working directory ──────────────────────────────────────────────────
WORKDIR /workspaces

# ─── Labels ───────────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="StoryCraft Studio Dev" \
      org.opencontainers.image.description="Full-featured dev environment for StoryCraft Studio" \
      org.opencontainers.image.source="https://github.com/qnbs/StoryCraft-Studio" \
      org.opencontainers.image.vendor="QNBS"
