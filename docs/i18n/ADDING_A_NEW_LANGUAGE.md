# Adding a New Language — Playbook

> Repeatable, high-confidence process for adding a UI locale to WorldScript Studio. Since the SSOT
> registry landed (`i18n/locales.ts`), adding a language is **one registry entry + content + fonts**
> — the locale list is no longer hand-maintained across eight files. Target: hours, not days.

## 0. Prerequisites

- Decide the **BCP-47 code** (ISO 639-1 where one exists: `ru`, `ko`, `nl`…). Region/script variants
  (`pt-BR`, `zh-Hant`) need the deferred BCP-47 architecture change — not covered here.
- Know the **script** (`latin`/`cyrillic`/`greek`/`cjk`/`arabic`/`hebrew`) and **direction**.
- Network access for the machine-translation step.

## 1. Register the locale (the only metadata edit)

Add one entry to `LOCALES` in **`i18n/locales.ts`** — code, `nativeName` (endonym), `englishName`,
`flag` emoji, `dir`, `status: 'beta'`, `script`, `helpFallback: true`. Everything downstream
(`Language` union, `RTL_LOCALES`, `SUPPORTED_LOCALES`, `LanguageSelector`, the parity/bundle/translate
scripts, the placeholder + registry tests) derives from this automatically.

If the script is **new** (first Cyrillic/Hangul/etc.):
- Extend `LocaleDescriptor['script']` in `i18n/locales.ts` and the `--font-ui-*` mapping.
- Add the Noto family to the Google Fonts `<link>` in `index.html` and a `:lang(<code>)` rule in
  `index.css` binding `--font-ui` to the right stack (see the CJK/Greek block).
- RTL scripts: the `[dir="rtl"]` swap in `index.css` already covers any new Arabic/Hebrew-script locale.

## 2. Scaffold content

```bash
cp -r locales/en locales/<code>          # 21 module JSONs, English placeholders
```

Add the localized exonym `portal.language.names.<code>` to **every** locale's `portal.json`
(`node scripts/check-i18n-keys.mjs --fix` backfills English; translate the ~17 exonyms by hand).
Add a cold-start entry in `services/i18nBootstrap.ts` and the TTS locale in `components/AiScratchpad.tsx`.

## 3. Translate (machine-translation pass)

The locale is MT-eligible automatically (filesystem-derived `getMtLocales()` in
`scripts/i18n-locales.mjs`). Seed a glossary block for `<code>` in
`locales/translation-glossary.json` first (brand terms verbatim: *WorldScript Studio*, *Co-Pilot*,
*ProForge*; domain terms: *Manuscript*, *Plot Board*, *Synopsis*…), then:

```bash
node scripts/bulk-translate-locales.mjs --lang=<code> --all --delay=600   # glossary-anchored, placeholder-masked, resumable
pnpm run i18n:bundle
```

`help.json` stays English fallback by design (`helpFallback: true`) — it is excluded from `--all`.

## 4. Gate locally (sequential — low-end hardware)

```bash
node scripts/check-suppressions.mjs        # OK
pnpm run lint
pnpm run typecheck
pnpm run i18n:check                         # parity + bundle rebuild
pnpm run i18n:report                        # coverage / placeholder / length / glossary per locale
pnpm exec vitest run tests/unit/i18nPlaceholders.test.ts tests/unit/i18n/localesRegistry.test.ts
```

The registry-integrity test (`tests/unit/i18n/localesRegistry.test.ts`) fails if the registry and the
`locales/` folders disagree — your new entry + folder must both exist.

## 5. Smoke + ship

- Run the app, switch to `<code>`: bundle loads, `<html lang>`/`<dir>` correct, glyphs render (no
  tofu), no console errors, selector shows flag + exonym + Beta badge.
- Update the README language list (Beta tag). Counts auto-sync via `scripts/sync-readme-metrics.mjs`.
- Open a PR **under ~100 files** (one language ≈ 22 files + wiring → comfortably under). Run the
  CodeAnt correction loop to quiescence, then admin-squash-merge. See
  [`docs/CODEANT-REVIEW-LOOP.md`](../CODEANT-REVIEW-LOOP.md).

## 6. Elevate quality (later)

New locales land as **Beta**. Raising them toward Production is the
[Beta-to-Production playbook](./BETA_TO_PRODUCTION_PLAYBOOK.md) (glossary expansion, help strategy,
status tier) — run it once the English source is stable.
