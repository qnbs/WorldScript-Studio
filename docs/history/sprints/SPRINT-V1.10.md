# Sprint v1.10 — Mobile UX, Coverage 55 %, Deploy & Help

**Release:** `v1.10.0` (2026-05-21)

## Goals

| Area | Outcome |
|------|---------|
| Mobile nav | Bottom tab: Scene Board replaces Characters; desktop sidebar unchanged |
| Mobile layout | `pb-mobile-nav` + CSS token clears fixed tab bar |
| Coverage | Branches ≥55 % (Vitest gate); RAG, help index, plot snap tests |
| Help | Plot Board v2, Hybrid RAG, Tauri articles + Try-it links |
| Settings | Tauri updater in About only; search UX fixes |
| Deploy | `docs/DEPLOYMENT.md` tag workflow notes; `deploy:cloudflare` parity |

## Validation

```bash
pnpm run typecheck
pnpm run i18n:check
pnpm run test:run
pnpm run test:coverage   # branches ≥55 %
pnpm run build:edge && pnpm run bundle:budget
```

## Post-release

- Lighthouse / PWA audit on low-end mobile (manual or CI when billing allows).
- Cloudflare Pages: prefer dashboard Git connect; optional tag workflow with secrets.
