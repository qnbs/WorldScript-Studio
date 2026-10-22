/**
 * Bundled third-party assets that require shipped license texts (#818 package C). Every
 * @fontsource import in index.tsx must appear here (tests/unit/thirdPartyNotices.test.ts), and
 * scripts/copy-third-party-licenses.mjs copies each package's LICENSE into public/licenses/fonts/.
 */

export interface BundledFontNotice {
  family: string;
  packageName: string;
  license: 'OFL-1.1';
}

export const BUNDLED_FONT_NOTICES: readonly BundledFontNotice[] = [
  { family: 'Inter', packageName: '@fontsource/inter', license: 'OFL-1.1' },
  { family: 'JetBrains Mono', packageName: '@fontsource/jetbrains-mono', license: 'OFL-1.1' },
  { family: 'Merriweather', packageName: '@fontsource/merriweather', license: 'OFL-1.1' },
  { family: 'Noto Naskh Arabic', packageName: '@fontsource/noto-naskh-arabic', license: 'OFL-1.1' },
  { family: 'Noto Sans', packageName: '@fontsource/noto-sans', license: 'OFL-1.1' },
  { family: 'Noto Sans Arabic', packageName: '@fontsource/noto-sans-arabic', license: 'OFL-1.1' },
  { family: 'Noto Sans Hebrew', packageName: '@fontsource/noto-sans-hebrew', license: 'OFL-1.1' },
  { family: 'Noto Sans JP', packageName: '@fontsource/noto-sans-jp', license: 'OFL-1.1' },
  { family: 'Noto Sans KR', packageName: '@fontsource/noto-sans-kr', license: 'OFL-1.1' },
  { family: 'Noto Sans SC', packageName: '@fontsource/noto-sans-sc', license: 'OFL-1.1' },
];

/** Same-origin path of a shipped license text, relative to the app base. */
export function fontLicensePath(notice: BundledFontNotice): string {
  return `licenses/fonts/${notice.packageName.replace('@fontsource/', '')}.txt`;
}

export const APP_LICENSE_PATH = 'licenses/worldscript-studio.txt';
