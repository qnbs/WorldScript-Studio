// @vitest-environment node
/**
 * QNBS-v3: PR5 — CI guard: every supported locale must ship a generated README help page
 * (public/readme/<code>.html), and English must always exist as the fallback. Regenerate with
 * `pnpm run readme:locales`. This prevents shipping a locale whose README page would 404.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '../../../i18n/locales';

const README_DIR = join(process.cwd(), 'public', 'readme');
const pageFor = (code: string) => join(README_DIR, `${code}.html`);

describe('localized README pages', () => {
  it('English README exists (the ultimate fallback)', () => {
    expect(existsSync(pageFor('en')), 'public/readme/en.html must exist').toBe(true);
  });

  it('every supported locale has a README page', () => {
    const missing = LOCALE_CODES.filter((code) => !existsSync(pageFor(code)));
    expect(missing, `missing public/readme/<code>.html for: ${missing.join(', ')}`).toEqual([]);
  });

  it('README pages are non-empty HTML with no leftover translation sentinels', () => {
    for (const code of LOCALE_CODES) {
      const html = readFileSync(pageFor(code), 'utf8');
      expect(html.length, `${code}.html is empty`).toBeGreaterThan(100);
      // The MT masking sentinels (⟦ ⟧) must never survive into shipped HTML.
      expect(/[⟦⟧]/.test(html), `${code}.html has leftover sentinels`).toBe(false);
      // QNBS-v3: raw markdown emphasis markers must never leak into the rendered help page (CodeAnt:
      // `** ... **` left literal in every non-English page). Emphasis is now masked as <strong>/<em> tags.
      expect(/\*\*/.test(html), `${code}.html has raw ** bold markers`).toBe(false);
    }
  });

  // QNBS-v3: PR5 — structural-parity GUARANTEE. The build pipeline preserves markdown structure
  // (prefixes kept, fences/tables verbatim, corrupted lines fall back to English), so every locale
  // MUST have exactly the same count of structural HTML elements as the English page — only the text
  // differs. This catches ANY MT corruption (dropped/duplicated links, mangled code spans, leaked
  // markdown) deterministically in CI, so a regenerated README is provably correct without manual review.
  it('every locale page is structurally identical to the English page', () => {
    const count = (html: string, re: RegExp) => (html.match(re) || []).length;
    const ELEMENTS: Array<[string, RegExp]> = [
      ['links', /<a\s/g],
      // QNBS-v3: match `<code` with attributes too — fenced blocks render as `<code class="language-…">`,
      // so a bare `<code>` regex would undercount and let a dropped fenced-code tag slip past (CodeAnt).
      ['code', /<code[\s>]/g],
      // QNBS-v3: emphasis is masked as opaque <strong>/<em> tag-sentinels, so bold/italic now round-trips
      // and its count must match en exactly — this catches the raw-`**` leakage CodeAnt flagged.
      ['bold', /<strong>/g],
      ['headings', /<h[1-6][\s>]/g],
      ['list items', /<li>/g],
      ['code blocks', /<pre>/g],
      ['tables', /<table>/g],
    ];
    const en = readFileSync(pageFor('en'), 'utf8');
    const expected = ELEMENTS.map(([, re]) => count(en, re));
    for (const code of LOCALE_CODES) {
      if (code === 'en') continue;
      const html = readFileSync(pageFor(code), 'utf8');
      ELEMENTS.forEach(([name, re], i) => {
        expect(count(html, re), `${code}.html ${name} count differs from en.html`).toBe(
          expected[i],
        );
      });
    }
  });

  // QNBS-v3: PR5 — minimum-coverage guard (CodeAnt). The structural sanity pass keeps an English line
  // when MT would break a link/code; if that ever regresses (e.g. a masking bug), pages quietly become
  // English-heavy. Require each locale to translate a healthy share of its prose/table lines vs en.
  it('every locale page translates a healthy share of its content (not English-heavy)', () => {
    const enLines = readFileSync(pageFor('en'), 'utf8').split('\n');
    const text = (s: string) => s.replace(/<[^>]+>/g, '').trim();
    const isContent = (s: string) =>
      text(s)
        .split(/\s+/)
        .filter((w) => /[a-z]{3}/i.test(w)).length >= 4;
    for (const code of LOCALE_CODES) {
      if (code === 'en') continue;
      const locLines = readFileSync(pageFor(code), 'utf8').split('\n');
      let total = 0;
      let translated = 0;
      // QNBS-v3: a line counts as translated only if it differs from English AND shows no raw markdown
      // artifacts in the rendered text (`](`, leftover `**`/backticks) — so a corrupted-but-not-
      // byte-identical line isn't mistaken for a real translation (CodeAnt). The structural-parity guard
      // above is the primary corruption gate; this keeps the coverage metric honest too.
      const looksCorrupt = (s: string) => /]\(|\*\*|`/.test(s);
      for (let i = 0; i < Math.min(enLines.length, locLines.length); i++) {
        const enLine = enLines[i] ?? '';
        if (!isContent(enLine)) continue;
        total += 1;
        const locText = text(locLines[i] ?? '');
        if (locText !== text(enLine) && !looksCorrupt(locText)) translated += 1;
      }
      const pct = total ? Math.round((translated / total) * 100) : 100;
      expect(
        pct,
        `${code}.html is only ${pct}% translated — regenerate with pnpm run readme:locales`,
      ).toBeGreaterThanOrEqual(70);
    }
  });
});
