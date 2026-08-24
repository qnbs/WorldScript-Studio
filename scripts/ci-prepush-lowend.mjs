import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  classifyChangedFiles,
  classifyProcessResult,
  requiresTypecheck,
} from './ci-prepush-classifier.mjs';
import {
  ensureDependencyState,
  runLocalBinaryDetailed,
  runNodeScriptDetailed,
} from './hooks/shared.mjs';

const projectRoot = process.cwd();
const full = process.argv.includes('--full');
const isPrePush = Boolean(process.env.WORLD_SCRIPT_PREPUSH_UPDATES);

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.stdout) return result.stdout.trim();
  if (result.status === 0 && !result.error) return '';
  if (allowFailure) return '';
  throw result.error ?? new Error(`git ${args.join(' ')} failed with status ${result.status}`);
}

function changedFilesFromWorkingTree() {
  return git(['diff', '--name-only', 'HEAD'], { allowFailure: true })
    .split('\n')
    .filter(Boolean)
    .concat(
      git(['ls-files', '--others', '--exclude-standard'], { allowFailure: true })
        .split('\n')
        .filter(Boolean),
    )
    .filter((file) => !file.startsWith('.worktrees/') && !file.startsWith('recovery-artifacts/'));
}

function changedFilesFromRef(target, base) {
  if (!target || !base) return [];
  return git(['diff', '--name-only', `${base}...${target}`], { allowFailure: true })
    .split('\n')
    .filter(Boolean);
}

function parsePrePushUpdates(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
    }));
}

// QNBS-v3: combine committed outgoing refs with safe working-tree changes without scanning preserved evidence trees.
function resolveChangeSet() {
  const files = new Set(changedFilesFromWorkingTree());
  const updates = parsePrePushUpdates(process.env.WORLD_SCRIPT_PREPUSH_UPDATES ?? '');

  if (updates.length > 0) {
    for (const { localSha, remoteSha } of updates) {
      if (/^0+$/.test(localSha)) continue;
      const base = /^0+$/.test(remoteSha)
        ? git(['rev-parse', 'origin/main'], { allowFailure: true })
        : remoteSha;
      for (const file of changedFilesFromRef(localSha, base)) files.add(file);
    }
  } else {
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
      allowFailure: true,
    });
    const base = git([...(upstream ? ['rev-parse', upstream] : ['rev-parse', 'origin/main'])], {
      allowFailure: true,
    });
    const head = git(['rev-parse', 'HEAD'], { allowFailure: true });
    for (const file of changedFilesFromRef(head, base)) files.add(file);
  }

  return { files: [...files], updates };
}

function report(name, status, detail = '') {
  console.log(`[local-admission] ${name.padEnd(26)} ${status}${detail ? ` — ${detail}` : ''}`);
  return status;
}

function runNodeCheck(name, script, args = [], timeoutMs = 120_000) {
  const result = runNodeScriptDetailed(script, args, { timeoutMs });
  const status = classifyProcessResult(result);
  report(name, status, result.timedOut ? `timeout after ${timeoutMs}ms` : (result.signal ?? ''));
  return status;
}

function runGitDiffCheck() {
  return runNodeCheck('Diff integrity', 'scripts/check-git-diff.mjs', [], 15_000);
}

function shouldRunI18n(classification) {
  return classification.files.some(
    (file) => file.startsWith('locales/') || file.startsWith('public/locales/'),
  );
}

function hasWorkflowChange(classification) {
  return classification.categories.includes('WORKFLOW');
}

const changes = resolveChangeSet();
const classification = classifyChangedFiles(changes.files);
const typecheckRequired = requiresTypecheck(classification, { full });
const results = [];

console.log(`[local-admission] change class: ${classification.kind}`);
console.log(`[local-admission] files considered: ${classification.files.length}`);

if (!ensureDependencyState()) {
  report('Dependency state', 'FAIL');
  process.exit(1);
}
results.push(['Dependency state', 'PASS']);

const mandatoryChecks = [
  ['Toolchain', () => runNodeCheck('Toolchain', 'scripts/check-pnpm-toolchain.mjs', ['--hook'])],
  ['Diff integrity', runGitDiffCheck],
  ['Docs/release truth', () => runNodeCheck('Docs/release truth', 'scripts/check-doc-metrics.mjs')],
  ['CSP policy', () => runNodeCheck('CSP policy', 'scripts/check-csp-policy.mjs')],
  [
    'Desktop import boundary',
    () => runNodeCheck('Desktop import boundary', 'scripts/check-tauri-import-boundary.mjs'),
  ],
  [
    'Native readiness',
    () => runNodeCheck('Native readiness', 'scripts/check-native-readiness.mjs'),
  ],
];

for (const [name, check] of mandatoryChecks) {
  const status = check();
  results.push([name, status]);
  if (status !== 'PASS') process.exit(1);
}

if (hasWorkflowChange(classification)) {
  const status = runNodeCheck('Workflow policy', 'scripts/check-workflow-policy.mjs');
  results.push(['Workflow policy', status]);
  if (status !== 'PASS') process.exit(1);
}

if (full || shouldRunI18n(classification)) {
  const i18nChecks = [
    ['i18n key parity', 'scripts/check-i18n-keys.mjs', [], 180_000],
    ...(full
      ? [
          ['i18n bundle rebuild', 'scripts/build-i18n.mjs', [], 180_000],
          ['i18n content guard', 'scripts/content-guard.mjs', [], 120_000],
          [
            'i18n translation quality',
            'scripts/i18n-quality-report.mjs',
            ['--strict', '--min-coverage', '75', '--max-length-outliers', '8'],
            180_000,
          ],
        ]
      : []),
  ];
  for (const [name, script, args, timeoutMs] of i18nChecks) {
    const status = runNodeCheck(name, script, args, timeoutMs);
    results.push([name, status]);
    if (status !== 'PASS') process.exit(1);
  }
}

if (typecheckRequired) {
  const result = runLocalBinaryDetailed(
    'tsgo',
    ['--project', 'tsconfig.tsgo.json', '--noEmit', '--checkers', full ? '4' : '1'],
    { timeoutMs: full ? 600_000 : 180_000 },
  );
  const status = classifyProcessResult(result);
  const detail = result.timedOut
    ? 'bounded timeout'
    : result.signal
      ? `terminated by ${result.signal}`
      : '';
  report('TypeScript', status, detail);
  results.push(['TypeScript', status]);
  if (status !== 'PASS') process.exit(1);
} else {
  report('TypeScript', 'DEFERRED_TO_REQUIRED_CI', 'no TypeScript-impacting changes detected');
  results.push(['TypeScript', 'DEFERRED_TO_REQUIRED_CI']);
}

console.log('\nLOCAL ADMISSION RESULT');
for (const [name, status] of results) console.log(`${name.padEnd(26)} ${status}`);
console.log('Outgoing signatures       SIGNING_HOOK_REQUIRED');
console.log('Cloud validation required YES');
console.log(`Classification             ${classification.kind}`);
console.log(`TypeScript full local     ${typecheckRequired ? 'REQUIRED' : 'DEFERRED'}`);
console.log(
  `LOCAL_ADMISSION_JSON ${JSON.stringify({
    classification,
    full,
    isPrePush,
    results: Object.fromEntries(results),
    outgoingSignatures: isPrePush ? 'PASS' : 'SIGNING_HOOK_REQUIRED',
    cloudValidationRequired: true,
  })}`,
);
