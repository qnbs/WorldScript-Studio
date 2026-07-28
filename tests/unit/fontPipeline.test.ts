// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Regression guard for the Google Fonts pipeline. "Noto Sans GR" does not exist at
// Google Fonts, so the combined CSS2 request 400'd — silently dropping the JP/KR families
// requested alongside it. Fixed by self-hosting CJK/Greek via @fontsource (index.tsx), matching
// the pattern already used for Arabic/Hebrew. These assertions lock the fix in place and prevent
// a future `--font-ui-*` addition from silently reintroducing an unhosted family.

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const indexTsx = readFileSync(fileURLToPath(new URL('../../index.tsx', import.meta.url)), 'utf8');
const indexCss = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

/**
 * Strip HTML (`<!-- -->`) and block (`/* *​/`) comments before a "must not contain" check. The
 * QNBS-v3 convention requires explaining *why* a value was removed, which means the historical
 * broken value (e.g. "Noto Sans GR", "fonts.gstatic.com") legitimately appears in prose — this
 * must not trip a regression test meant to catch an actual re-introduced *live* reference.
 */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract capture group 1 with a narrowing guard (noUncheckedIndexedAccess-safe). */
function group1(m: RegExpMatchArray | null, msg: string): string {
  if (!m || m[1] === undefined) throw new Error(msg);
  return m[1];
}

function connectSrcLikeTokens(directive: string, csp: string): string[] {
  return group1(csp.match(new RegExp(`${directive}([^;]*);`)), `${directive} directive must exist`)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function webCsp(): string {
  return group1(
    indexHtml.match(/Content-Security-Policy"\s*\n?\s*content="([\s\S]*?)"/),
    'web CSP meta must exist in index.html',
  );
}

// QNBS-v3: families that intentionally have no @fontsource import — e.g. a documented
// system-fallback decision. Empty today; keep this as the single place to record an exception
// rather than silently skipping the loop below.
const SYSTEM_FALLBACK_ALLOWLIST: readonly string[] = [];

/** Pull every `--font-ui-*: "Family", ...;` declaration's families out of index.css. */
function fontUiFamilyDeclarations(): { token: string; families: string[] }[] {
  const declarations: { token: string; families: string[] }[] = [];
  const re = /--(font-ui[\w-]*):\s*([^;]+);/g;
  for (const m of indexCss.matchAll(re)) {
    const token = m[1];
    const value = m[2];
    if (!token || !value) continue;
    const families = [...value.matchAll(/"([^"]+)"/g)]
      .map((f) => f[1])
      .filter((f): f is string => !!f);
    declarations.push({ token, families });
  }
  return declarations;
}

describe('Font pipeline — no external font CDN, self-hosted CJK/Greek', () => {
  it('index.html has no live reference to fonts.googleapis.com or fonts.gstatic.com', () => {
    const html = stripComments(indexHtml);
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('index.css has no live reference to a Google Fonts host', () => {
    const css = stripComments(indexCss);
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('meta CSP style-src has no foreign font-CDN origin', () => {
    const tokens = connectSrcLikeTokens('style-src', webCsp());
    expect(tokens).not.toContain('https://fonts.googleapis.com');
  });

  it('meta CSP font-src has no foreign font-CDN origin', () => {
    const tokens = connectSrcLikeTokens('font-src', webCsp());
    expect(tokens).not.toContain('https://fonts.gstatic.com');
  });

  it('the nonexistent "Noto Sans GR" family has no live reference in any font source file', () => {
    for (const file of [indexHtml, indexTsx, indexCss].map(stripComments)) {
      expect(file).not.toMatch(/Noto\s*\+?\s*Sans\s*\+?\s*GR/);
    }
  });

  it('every --font-ui-* family in index.css is self-hosted via @fontsource in index.tsx, or is an explicit system-fallback exception', () => {
    const declarations = fontUiFamilyDeclarations();
    expect(declarations.length).toBeGreaterThan(0);

    for (const { families } of declarations) {
      for (const family of families) {
        // System-default families never need a font import.
        if (/^(system-ui|-apple-system|sans-serif|serif|monospace|ui-monospace)$/i.test(family)) {
          continue;
        }
        // A pure-Latin fallback (Inter/Merriweather/JetBrains Mono) is covered by the base
        // @fontsource imports already asserted elsewhere; only non-Latin families are the point
        // of this test.
        if (/^(Inter|Merriweather|JetBrains Mono)$/.test(family)) continue;

        if (SYSTEM_FALLBACK_ALLOWLIST.includes(family)) continue;

        // e.g. "Noto Sans JP" -> @fontsource/noto-sans-jp; "Noto Sans" -> @fontsource/noto-sans
        const pkg = `@fontsource/${family.toLowerCase().replace(/\s+/g, '-')}`;
        expect(
          indexTsx.includes(`'${pkg}/`),
          `expected an @fontsource import for "${family}" (package "${pkg}") in index.tsx, or an entry in SYSTEM_FALLBACK_ALLOWLIST`,
        ).toBe(true);
      }
    }
  });
});
