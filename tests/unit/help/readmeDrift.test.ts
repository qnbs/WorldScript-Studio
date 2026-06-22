// @vitest-environment node
/**
 * QNBS-v3: PR5 — drift guard. The localized README help pages are generated from README.md; if README
 * changes but `pnpm run readme:locales` is not re-run, the in-app README goes stale. This guard
 * recomputes the deterministic English page (curate + render, NO network/MT) and fails if it differs
 * from the committed public/readme/en.html — forcing a regen. (The translated locale pages can't be
 * checked here without network; the English page is the canary.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curate, renderHtml } from '../../../scripts/build-readme-locales.mjs';

describe('README localization drift', () => {
  it('public/readme/en.html matches the current README.md (run `pnpm run readme:locales` after README edits)', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    const expected = renderHtml(curate(readme), 'en');
    const committed = readFileSync(join(process.cwd(), 'public', 'readme', 'en.html'), 'utf8');
    expect(committed).toBe(expected);
  });
});
