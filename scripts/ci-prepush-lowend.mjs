import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { shouldRunAdmissionCheck } from './ci-prepush-check-registry.mjs';
import {
  classifyChangedFiles,
  manualAdmissionNeedsFullValidation,
  requiresTypecheck,
} from './ci-prepush-classifier.mjs';
import { ensureDependencyState, runLocalBinary, runNodeScript } from './hooks/shared.mjs';
import { readPrePushEvidenceFile, resolvePushEvidence } from './signing/signing-core.mjs';

const evidenceIndex = process.argv.indexOf('--prepush-evidence-file');
let evidenceChangedFiles;
if (evidenceIndex >= 0) {
  try {
    const evidence = resolvePushEvidence(
      readPrePushEvidenceFile(process.argv[evidenceIndex + 1]),
      process.cwd(),
    );
    if (evidence.evidenceState !== 'RESOLVED')
      throw new Error(evidence.reason ?? 'invalid evidence');
    evidenceChangedFiles = evidence.changedFiles;
  } catch (error) {
    console.error(`[local-lowend] outgoing evidence rejected: ${error.message}`);
    process.exit(1);
  }
}

const fullRequested = process.argv.includes('--full');

function gitRaw(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout ?? '';
}

function gitOptional(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '') : null;
}

function parseNulDelimitedPaths(output) {
  return output.split('\0').filter(Boolean);
}

function changedFilesFromWorkingTree() {
  return parseNulDelimitedPaths(
    gitRaw(['diff', '--no-renames', '--name-only', '-z', 'HEAD']),
  ).concat(parseNulDelimitedPaths(gitRaw(['ls-files', '--others', '--exclude-standard', '-z'])));
}

function changedFilesFromManualRange() {
  const upstream = gitOptional(['rev-parse', '--verify', '@{upstream}'])?.trim();
  if (upstream)
    return {
      files: parseNulDelimitedPaths(
        gitRaw(['diff', '--no-renames', '--name-only', '-z', `${upstream}..HEAD`]),
      ).concat(changedFilesFromWorkingTree()),
      rangeResolved: true,
    };

  return { files: [], rangeResolved: false };
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

const manualEvidence =
  evidenceIndex >= 0
    ? { files: evidenceChangedFiles, rangeResolved: true }
    : changedFilesFromManualRange();
const full =
  fullRequested || (!manualEvidence.rangeResolved && manualAdmissionNeedsFullValidation(false));
const files = manualEvidence.files;
const classification = manualEvidence.rangeResolved
  ? classifyChangedFiles(files)
  : { kind: 'AMBIGUOUS', categories: ['UNKNOWN'], files: [] };
const typecheckRequired = requiresTypecheck(classification, { full });

console.log(`[local-admission] change class: ${classification.kind}`);
console.log(`[local-admission] files considered: ${classification.files.length}`);
if (!manualEvidence.rangeResolved && evidenceIndex < 0)
  console.log(
    '[local-admission] manual committed range unresolved; using conservative full admission',
  );

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
    // QNBS-v3: one checker bounds memory use on constrained developer machines.
    runLocalBinary('tsgo', ['--project', 'tsconfig.tsgo.json', '--noEmit', '--checkers', '1']),
  );
} else {
  report('TypeScript', 'DEFERRED_TO_REQUIRED_CI', 'no TypeScript-impacting changes detected');
}

console.log('\nLOCAL ADMISSION RESULT');
console.log('Local checks completed sequentially.');
console.log('Cloud validation required YES');
console.log(`Classification             ${classification.kind}`);
