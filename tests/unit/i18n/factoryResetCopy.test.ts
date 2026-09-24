// @vitest-environment node
// QNBS-v3 (#526): Factory Reset deletes only positively WorldScript-owned storage, so downloaded local AI/voice model caches (vendor-named, not provably owned) can survive it. Its copy must therefore point at the one control that does clear them, by that control's real label in the same locale — a renamed button or a missed locale would silently turn the pointer back into an untruthful promise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '../../../i18n/locales';

function loadBundle(lang: string): Record<string, string> {
  const path = join(process.cwd(), 'public', 'locales', lang, 'bundle.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const RESET_COPY_KEYS = [
  'settings.data.dangerZone.factoryReset.hint',
  'settings.data.dangerZone.factoryReset.modalDescription',
];

describe('Factory Reset copy names the control that clears local models', () => {
  it.each(LOCALE_CODES)('%s', (lang) => {
    const bundle = loadBundle(lang);
    const clearLabel = bundle['settings.ai.localAi.clearButton'];
    expect(clearLabel).toBeTruthy();
    for (const key of RESET_COPY_KEYS) {
      expect(bundle[key], key).toContain(clearLabel);
    }
  });
});
