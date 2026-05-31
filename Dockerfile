# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# QNBS-v3: SHA-pinned to prevent supply-chain attacks (Scorecard Pinned-Dependencies).
FROM node:22-alpine@sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c AS builder

# QNBS-v3: pnpm via corepack avoids a separate install layer and respects packageManager field.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Install deps (cache layer — only invalidated when lock file changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile

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
