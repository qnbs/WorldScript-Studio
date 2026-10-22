import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_LICENSE_PATH,
  BUNDLED_FONT_NOTICES,
  fontLicensePath,
} from '../../services/thirdPartyNotices';

const root = resolve(__dirname, '../..');

/** The OFL requires the license text to accompany every bundled font (#818 package C). */
describe('third-party notices', () => {
  it('lists exactly the @fontsource packages index.tsx bundles', () => {
    const imported = new Set(
      [
        ...readFileSync(resolve(root, 'index.tsx'), 'utf8').matchAll(
          /'(@fontsource\/[a-z0-9-]+)\//g,
        ),
      ].map(([, pkg = '']) => pkg),
    );
    expect([...imported].sort()).toEqual(BUNDLED_FONT_NOTICES.map((n) => n.packageName).sort());
  });

  it.each(BUNDLED_FONT_NOTICES.map((n) => [n.packageName, n] as const))(
    '%s is OFL-1.1 and ships a LICENSE file',
    (pkg, notice) => {
      const manifest = JSON.parse(
        readFileSync(resolve(root, 'node_modules', pkg, 'package.json'), 'utf8'),
      ) as { license: string };
      expect(manifest.license).toBe(notice.license);
      expect(existsSync(resolve(root, 'node_modules', pkg, 'LICENSE'))).toBe(true);
    },
  );

  it('maps notices to same-origin license paths', () => {
    const inter = BUNDLED_FONT_NOTICES.find((notice) => notice.family === 'Inter');
    expect(inter && fontLicensePath(inter)).toBe('licenses/fonts/inter.txt');
    expect(APP_LICENSE_PATH).toBe('licenses/worldscript-studio.txt');
  });
});
