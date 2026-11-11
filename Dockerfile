# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# QNBS-v3: SHA-pinned to prevent supply-chain attacks (Scorecard Pinned-Dependencies); exact Node patch at or above the security floor in tests/unit/tooling/nodeRuntimePins.test.ts (#1245).
FROM node:22.23.5-alpine3.24@sha256:d6e6d1cae4ed0cda2dc336db1bbea6457c2b5d2a8bcd9ac1d80b909fe1c4f638 AS builder

# QNBS-v3: Corepack takes pnpm from package.json#packageManager only; a second pin here drifted silently (#1223).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Install deps (cache layer — only invalidated when lock file changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
COPY packages/ ./packages/
# QNBS-v3 (#1225): the build fails unless the active pnpm is the packageManager pin, however pnpm got onto the PATH.
RUN test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")" && pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run build

# ─── Stage 2: Serve ───────────────────────────────────────────────────────────
# QNBS-v3: SHA-pinned to prevent supply-chain attacks (Scorecard Pinned-Dependencies).
FROM nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8 AS runner

# Remove default nginx site; replace with SPA config
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
