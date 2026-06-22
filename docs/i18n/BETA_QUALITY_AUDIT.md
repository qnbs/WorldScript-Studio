# Beta Quality Audit

> Snapshot audit of the non-Production locales and the tier each can realistically reach **without
> native human review**. Data source: `pnpm run i18n:status` / `pnpm run i18n:report`. Live numbers:
> [TRANSLATION_STATUS](./TRANSLATION_STATUS.md).

## Method

"UI coverage" = share of string values that differ from the English source, computed over the **UI
modules only** (`help.json` is excluded — it is intentionally English fallback for non-Production
locales, so including it would understate real UI coverage). "Placeholder issues" is the hard-gated
count of `{{token}}` mismatches vs English (must be 0). Glossary terms = anchor count.

### Why promotion is conservative (not raw-coverage-driven)

The coverage % is a **completeness** signal, not a **quality** signal, and it is **noisy**: a
Production locale that *correctly* keeps brand/technical terms identical to English (WorldScript
Studio, Co-Pilot, ProForge, PDF/DOCX, provider names) scores *lower* on this metric, while a machine
translation that *over-translates* those terms scores *higher*. So a high % is **necessary but not
sufficient** for promotion. We therefore promote conservatively: only **established** Beta locales with
≥96% UI coverage **and** 0 placeholder issues **and** real release exposure — currently `ja`, `zh`,
`pt`, `el`. Brand-new locales (`ru`, `ko`, added this cycle) and lower-exposure ones stay Beta despite
high raw coverage, pending a re-translation/spot-check pass per the
[playbook](./BETA_TO_PRODUCTION_PLAYBOOK.md). Live numbers: [TRANSLATION_STATUS](./TRANSLATION_STATUS.md).

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
