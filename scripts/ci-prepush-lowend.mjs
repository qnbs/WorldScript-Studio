import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { shouldRunAdmissionCheck } from './ci-prepush-check-registry.mjs';
import {
  classifyChangedFiles,
  manualAdmissionNeedsFullValidation,
  requiresTypecheck,
} from './ci-prepush-classifier.mjs';
import { resolveManualEvidence } from './ci-prepush-range-resolver.mjs';
import { ensureDependencyState, runLocalBinary, runNodeScript } from './hooks/shared.mjs';

function report(name, status, detail = '') {
  console.log(`[local-admission] ${name.padEnd(26)} ${status}${detail ? ` — ${detail}` : ''}`);
  return status;
}

function runCheck(name, run) {
  const status = run();
  report(name, status === 0 ? 'PASS' : 'FAIL');
  if (status !== 0) process.exit(status ?? 1);
}

function main() {
  const evidenceIndex = process.argv.indexOf('--prepush-evidence-file');
  const evidenceFile = evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined;
  const fullRequested = process.argv.includes('--full');

  let manualEvidence;
  try {
    manualEvidence = resolveManualEvidence(evidenceFile);
  } catch (error) {
    console.error(`[local-lowend] outgoing evidence rejected: ${error.message}`);
    process.exit(1);
  }

  const full = fullRequested || manualAdmissionNeedsFullValidation(manualEvidence.rangeResolved);
  const classification = manualEvidence.rangeResolved
    ? classifyChangedFiles(manualEvidence.files)
    : { kind: 'AMBIGUOUS', categories: ['UNKNOWN'], files: [] };
  const typecheckRequired = requiresTypecheck(classification, { full });

  console.log(`[local-admission] change class: ${classification.kind}`);
  console.log(`[local-admission] files considered: ${classification.files.length}`);
  if (!manualEvidence.rangeResolved)
    console.log(
      '[local-admission] change evidence incomplete or unresolved; using conservative full admission',
    );

  if (!ensureDependencyState()) {
    report('Dependency state', 'FAIL');
    process.exit(1);
  }
  report('Dependency state', 'PASS');

  runCheck('Toolchain', () => runNodeScript('scripts/check-pnpm-toolchain.mjs', ['--hook']));
  runCheck('Docs/release truth', () => runNodeScript('scripts/check-doc-metrics.mjs'));
  runCheck('CSP policy', () => runNodeScript('scripts/check-csp-policy.mjs'));
  runCheck('Desktop import boundary', () =>
    runNodeScript('scripts/check-tauri-import-boundary.mjs'),
  );
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
}

// QNBS-v3: guard execution so this module can be imported for testing without running the CLI.
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) main();
