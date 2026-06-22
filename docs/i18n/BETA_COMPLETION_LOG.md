# Beta Completion Log

Decisions + rationale for the Beta-to-Production elevation work (PR4 of the i18n program). See the
chronological program log in [IMPLEMENTATION_LOG](./IMPLEMENTATION_LOG.md).

## PR4 — status tiers, dashboard, help notice

- **Three-tier status system** surfaced from the SSOT (`status` already existed in `i18n/locales.ts`):
  🟢 Production / 🟡 Near-Production / 🔵 Beta. Definitions in
  [BETA_TO_PRODUCTION_PLAYBOOK](./BETA_TO_PRODUCTION_PLAYBOOK.md).
- **Promotions (data-driven, conservative):** `ja`, `zh`, `pt`, `el` → Near-Production — each ≥96% UI
  coverage with 0 placeholder issues. Held back: `ru`/`ko` (94%, brand-new) and the 89–91% locales,
  pending a high-visibility-module re-translation pass; `ar`/`he` remain English-anchored stubs.
  **Rationale:** promote only on hard data (coverage + 0 placeholder issues), never on optimism.
- **Dashboard:** `scripts/i18n-status-dashboard.ts` (`pnpm run i18n:status`) generates
  [TRANSLATION_STATUS](./TRANSLATION_STATUS.md) — a TS script (run via tsx) because it needs the typed
  registry's `status`, which the `.mjs` reporters cannot import.
- **Help transparency:** the in-app Help view shows `help.machineTranslatedNotice` when the active
  locale's `helpFallback` is true (all non-Production locales), so users know long-form articles are
  English. Key added to all 19 locales (core 5 translated; the rest English — consistent with their
  help being English anyway).
- **README:** language list tagged by tier + a tier-definitions line pointing at the dashboard.

## Remaining work that needs native human review

- Translated `help.json` for every non-core locale (the Production blocker; MT mangles its HTML).
- A native microcopy pass to move any Near-Production locale to full Production.
- Promotion of the 89–94% Beta locales after the playbook's re-translation pass.

These are tracked, honestly, in [TRANSLATION_STATUS](./TRANSLATION_STATUS.md) and
[BETA_QUALITY_AUDIT](./BETA_QUALITY_AUDIT.md) — the app never overstates a locale's quality.
