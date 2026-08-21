import process from 'node:process';
import { ensureDependencyState, runLocalBinary, runNodeScript } from './hooks/shared.mjs';

const checks = [
  ['toolchain', () => runNodeScript('scripts/check-pnpm-toolchain.mjs', ['--hook'])],
  [
    'typecheck (single checker)',
    () => runLocalBinary('tsgo', ['--project', 'tsconfig.tsgo.json', '--noEmit']),
  ],
  ['i18n key parity', () => runNodeScript('scripts/check-i18n-keys.mjs')],
  ['i18n bundle rebuild', () => runNodeScript('scripts/build-i18n.mjs')],
  ['i18n content guard', () => runNodeScript('scripts/content-guard.mjs')],
  [
    'i18n translation quality',
    () =>
      runNodeScript('scripts/i18n-quality-report.mjs', [
        '--strict',
        '--min-coverage',
        '75',
        '--max-length-outliers',
        '8',
      ]),
  ],
  ['release/doc truth', () => runNodeScript('scripts/check-doc-metrics.mjs')],
  ['desktop import boundary', () => runNodeScript('scripts/check-tauri-import-boundary.mjs')],
  ['native readiness', () => runNodeScript('scripts/check-native-readiness.mjs')],
];

if (!ensureDependencyState()) process.exit(1);

for (const [name, run] of checks) {
  console.log(`[local-lowend] ${name}`);
  const status = run();
  if (status !== 0) {
    console.error(`[local-lowend] failed: ${name}`);
    process.exit(status);
  }
}

console.log('[local-lowend] pre-push checks passed sequentially.');
