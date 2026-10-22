#!/usr/bin/env node
/**
 * Ships the license texts of bundled third-party assets with the app (#818 package C): the SIL Open
 * Font License requires the copyright notice and license to accompany the fonts, so each
 * @fontsource package's LICENSE is copied to `public/licenses/fonts/<name>.txt`, and the app's own
 * MIT license to `public/licenses/worldscript-studio.txt`. Settings → About links these local files.
 * Run via predev/prebuild — idempotent. `public/licenses/` is gitignored: build artifacts of the
 * pinned dependencies, not source. The font list is services/thirdPartyNotices.ts (single source).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const notices = readFileSync(join(root, 'services', 'thirdPartyNotices.ts'), 'utf8');
const packages = [...notices.matchAll(/packageName: '(@fontsource\/[a-z0-9-]+)'/g)].map(
  (m) => m[1],
);
if (packages.length === 0)
  throw new Error('[licenses] no bundled fonts found in thirdPartyNotices.ts');

const fontsDir = join(root, 'public', 'licenses', 'fonts');
mkdirSync(fontsDir, { recursive: true });
for (const pkg of packages) {
  const src = join(root, 'node_modules', pkg, 'LICENSE');
  if (!existsSync(src)) throw new Error(`[licenses] missing license file: ${src}`);
  copyFileSync(src, join(fontsDir, `${pkg.replace('@fontsource/', '')}.txt`));
}
copyFileSync(join(root, 'LICENSE'), join(root, 'public', 'licenses', 'worldscript-studio.txt'));
console.log(
  `[licenses] copied ${packages.length} font licenses and the app license to public/licenses/`,
);
