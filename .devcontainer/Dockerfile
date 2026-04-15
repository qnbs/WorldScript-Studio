ARG VARIANT="22-bullseye"
FROM mcr.microsoft.com/devcontainers/javascript-node:0-${VARIANT}

# Install system dependencies required for Tauri and native builds
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    pkg-config \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    libappindicator3-dev \
    libsecret-1-dev \
    libsoup2.4-dev \
  && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain for Tauri development
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable \
  && /root/.cargo/bin/rustup target add x86_64-unknown-linux-gnu

ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /workspace
