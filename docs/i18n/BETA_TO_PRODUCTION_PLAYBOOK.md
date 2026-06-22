# Beta → Production Playbook

> Repeatable process for raising a locale's quality tier without native human review — as far as
> glossary-driven, context-aware machine translation honestly allows. Companion:
> [TRANSLATION_STATUS](./TRANSLATION_STATUS.md) (live dashboard),
> [BETA_QUALITY_AUDIT](./BETA_QUALITY_AUDIT.md).

## Tiers (the `status` field in `i18n/locales.ts`)

| Tier | Bar | help.json |
|------|-----|-----------|
| 🟢 **Production** | full key parity + native-quality UI **and** translated help | translated |
| 🟡 **Near-Production** | ≥96% UI string coverage, **0** placeholder-integrity issues | English fallback |
| 🔵 **Beta** | key parity holds; UI machine-translated or partial | English fallback |

Promotion is **data-driven**, read from `pnpm run i18n:status` / `pnpm run i18n:report`. We never
label machine output as native quality — Near-Production explicitly still carries an English-help gap
and an in-app notice (`help.machineTranslatedNotice`).

## Raising a Beta locale toward Near-Production

1. **Measure** — `pnpm run i18n:report` for the locale's coverage, placeholder issues, length
   outliers, glossary-term count.
2. **Glossary first** — ensure the locale has a block in `locales/translation-glossary.json` and that
   brand terms (WorldScript Studio / Co-Pilot / ProForge) are verbatim. Expand domain terms.
3. **Re-translate the highest-visibility modules** with the glossary anchor (context-aware, multi-pass):
   `common`, `sidebar`, `settings`, `manuscript`, `dashboard`, `copilot`, `writer`:
   `node scripts/bulk-translate-locales.mjs --lang=<code> --files=common,sidebar,settings,manuscript,dashboard,copilot,writer --delay=600`
   then `pnpm run i18n:bundle`.
4. **Gate** — `pnpm run i18n:check` (parity) + `pnpm exec vitest run tests/unit/i18nPlaceholders.test.ts`
   (placeholder integrity is a hard gate — MT must not mangle `{{tokens}}`).
5. **Promote** — when coverage ≥96% with 0 placeholder issues, change `status` to `'near-production'`
   in `i18n/locales.ts`. The README tier line + `i18n:status` dashboard update automatically; the Help
   view keeps the English-fallback notice while `helpFallback` stays true.

## Reaching Production

Requires what MT cannot self-certify: a **native human pass** over UI microcopy **and** a translated
`help.json` (then flip `helpFallback: false`). Everything up to that point is automatable; this last
step is the documented, honest limit.

## What stays English by design

`help.json` long-form articles are excluded from `--all` (the free MT endpoint mangles their tag-dense
HTML). They are the primary Production blocker and a good first community-contribution target.
