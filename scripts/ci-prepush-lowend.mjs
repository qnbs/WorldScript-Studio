import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { shouldRunAdmissionCheck } from './ci-prepush-check-registry.mjs';
import { classifyChangedFiles, requiresTypecheck } from './ci-prepush-classifier.mjs';
import { ensureDependencyState, runLocalBinary, runNodeScript } from './hooks/shared.mjs';

const full = process.argv.includes('--full');

function gitRaw(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout ?? '';
}

function parseNulDelimitedPaths(output) {
  return output.split('\0').filter(Boolean);
}

function changedFilesFromWorkingTree() {
  return parseNulDelimitedPaths(
    gitRaw(['diff', '--no-renames', '--name-only', '-z', 'HEAD']),
  ).concat(parseNulDelimitedPaths(gitRaw(['ls-files', '--others', '--exclude-standard', '-z'])));
}

function report(name, status, detail = '') {
  console.log(`[local-admission] ${name.padEnd(26)} ${status}${detail ? ` — ${detail}` : ''}`);
  return status;
}

function runCheck(name, run) {
  const status = run();
  report(name, status === 0 ? 'PASS' : 'FAIL');
  if (status !== 0) process.exit(status ?? 1);
}

const files = changedFilesFromWorkingTree();
const classification = classifyChangedFiles(files);
const typecheckRequired = requiresTypecheck(classification, { full });

console.log(`[local-admission] change class: ${classification.kind}`);
console.log(`[local-admission] files considered: ${classification.files.length}`);

if (!ensureDependencyState()) {
  report('Dependency state', 'FAIL');
  process.exit(1);
}
report('Dependency state', 'PASS');

runCheck('Toolchain', () => runNodeScript('scripts/check-pnpm-toolchain.mjs', ['--hook']));
runCheck('Docs/release truth', () => runNodeScript('scripts/check-doc-metrics.mjs'));
runCheck('CSP policy', () => runNodeScript('scripts/check-csp-policy.mjs'));
runCheck('Desktop import boundary', () => runNodeScript('scripts/check-tauri-import-boundary.mjs'));
runCheck('Native readiness', () => runNodeScript('scripts/check-native-readiness.mjs'));

if (shouldRunAdmissionCheck('i18n', classification.files) || full) {
  runCheck('i18n key parity', () => runNodeScript('scripts/check-i18n-keys.mjs'));
  runCheck('i18n bundle rebuild', () => runNodeScript('scripts/build-i18n.mjs'));
  runCheck('i18n translation quality', () =>
    runNodeScript('scripts/i18n-quality-report.mjs', [
      '--strict',
      '--min-coverage',
      '75',
      '--max-length-outliers',
      '8',
    ]),
  );
}

if (shouldRunAdmissionCheck('contentGuard', classification.files) || full)
  runCheck('Content guard', () => runNodeScript('scripts/content-guard.mjs'));

if (typecheckRequired) {
  runCheck('TypeScript (single checker)', () =>
    runLocalBinary('tsgo', ['--project', 'tsconfig.tsgo.json', '--noEmit', '--checkers', '1']),
  );
} else {
  report('TypeScript', 'DEFERRED_TO_REQUIRED_CI', 'no TypeScript-impacting changes detected');
}

console.log('\nLOCAL ADMISSION RESULT');
console.log('Local checks completed sequentially.');
console.log('Cloud validation required YES');
console.log(`Classification             ${classification.kind}`);
