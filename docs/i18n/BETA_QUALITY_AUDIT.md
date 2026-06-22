# Beta Quality Audit

> Snapshot audit of the non-Production locales and the tier each can realistically reach **without
> native human review**. Data source: `pnpm run i18n:status` / `pnpm run i18n:report`. Live numbers:
> [TRANSLATION_STATUS](./TRANSLATION_STATUS.md).

## Method

"UI coverage" = share of string values that differ from the English source (brand/technical terms that
are legitimately identical lower it slightly — it is a guide, not a gate). "Placeholder issues" is the
hard-gated count of `{{token}}` mismatches vs English (must be 0). Glossary terms = anchor count.

## Findings (2026-06)

- **Strongest (promoted to 🟡 Near-Production):** `zh` 98%, `ja` 97%, `pt` 96%, `el` 96% — all with
  **0 placeholder issues** and full glossary coverage. The only gap to Production is `help.json`
  (English fallback) + a native microcopy pass.
- **Solid Beta (90–94%):** `ru` 94%, `ko` 94%, `eu` 91%, `fa` 91%, `is` 90%. Newly added (ru/ko) or
  Phase-X locales; candidates for the next Near-Production promotion after a high-visibility-module
  re-translation pass.
- **Lower Beta (89%):** `fi`, `sv`, `hu` — more untranslated UI strings; glossary present.
- **English-anchored stubs (76%):** `ar`, `he` — RTL Beta stubs (B-5); their layout/RTL foundation is
  mature, but text is largely English placeholder. Full content is a v2.0 community task.

## Feasibility without native review

| Outcome | Achievable by MT + glossary + tooling? |
|---------|----------------------------------------|
| Key parity (all 19) | ✅ already enforced in CI |
| 0 placeholder issues (all 19) | ✅ already true |
| ≥96% UI coverage on high-visibility modules | ✅ for most; the re-translation pass in the playbook |
| Translated `help.json` | ⚠️ MT mangles its HTML; needs human/structured effort |
| Native-quality microcopy (true Production) | ❌ needs a native speaker |

## Honest limits

No machine pass makes a locale truly Production. Near-Production is the ceiling this process targets,
and the app communicates it transparently (tier in README + dashboard, English-help notice in the Help
view). Remaining Production work per locale is tracked in [TRANSLATION_STATUS](./TRANSLATION_STATUS.md).
