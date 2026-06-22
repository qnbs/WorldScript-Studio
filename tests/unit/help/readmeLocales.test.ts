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
    }
  });
});
