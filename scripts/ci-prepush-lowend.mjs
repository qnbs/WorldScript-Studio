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
  if (result.status === 0) return result.stdout?.trim() ?? '';
  if (allowFailure) return '';
  throw result.error ?? new Error(`git ${args.join(' ')} failed with status ${result.status}`);
}

function changedFilesFromWorkingTree() {
  return git(['diff', '--no-renames', '--name-only', 'HEAD'], { allowFailure: true })
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
  if (!target || !base) throw new Error('outgoing comparison base or target is unresolved');
  return git(['diff', '--no-renames', '--name-only', `${base}...${target}`])
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
  const ranges = [];
  const updates = parsePrePushUpdates(process.env.WORLD_SCRIPT_PREPUSH_UPDATES ?? '');
  let unresolved = false;

  function addRefFiles(target, base) {
    try {
      ranges.push(`${base}...${target}`);
      for (const file of changedFilesFromRef(target, base)) files.add(file);
    } catch (error) {
      unresolved = true;
      console.error(`[local-admission] outgoing change range unresolved: ${error.message}`);
    }
  }

  if (updates.length > 0) {
    for (const { localSha, remoteSha } of updates) {
      if (/^0+$/.test(localSha)) continue;
      let base = remoteSha;
      if (/^0+$/.test(base)) {
        try {
          base = git(['rev-parse', 'origin/main']);
        } catch (error) {
          unresolved = true;
          console.error(`[local-admission] origin/main unresolved: ${error.message}`);
        }
      }
      addRefFiles(localSha, base);
    }
  } else {
    let upstream = '';
    try {
      upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    } catch {
      // A detached or new branch may not have an upstream yet; origin/main is the safe fallback.
    }
    let base = '';
    try {
      base = git([...(upstream ? ['rev-parse', upstream] : ['rev-parse', 'origin/main'])]);
    } catch (error) {
      unresolved = true;
      console.error(`[local-admission] comparison base unresolved: ${error.message}`);
    }
    let head = '';
    try {
      head = git(['rev-parse', 'HEAD']);
    } catch (error) {
      unresolved = true;
      console.error(`[local-admission] HEAD unresolved: ${error.message}`);
    }
    addRefFiles(head, base);
  }

  return { files: [...files], ranges, updates, unresolved };
}

function report(name, status, detail = '') {
  console.log(`[local-admission] ${name.padEnd(26)} ${status}${detail ? ` — ${detail}` : ''}`);
  return status;
}

async function runNodeCheck(name, script, args = [], timeoutMs = 120_000, env = {}) {
  const result = await runNodeScriptDetailed(script, args, { timeoutMs, env });
  const status = classifyProcessResult(result);
  report(name, status, result.timedOut ? `timeout after ${timeoutMs}ms` : (result.signal ?? ''));
  return status;
}

async function runGitDiffCheck(ranges) {
  return runNodeCheck('Diff integrity', 'scripts/check-git-diff.mjs', [], 15_000, {
    WORLD_SCRIPT_PREPUSH_DIFF_RANGES: ranges.join('\n'),
  });
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
const baseClassification = classifyChangedFiles(changes.files);
const classification = changes.unresolved
  ? {
      ...baseClassification,
      kind: 'AMBIGUOUS',
      categories: [...new Set([...baseClassification.categories, 'UNKNOWN'])],
    }
  : baseClassification;
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
  ['Diff integrity', () => runGitDiffCheck(changes.ranges)],
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
  const status = await check();
  results.push([name, status]);
  if (status !== 'PASS') process.exit(1);
}

if (hasWorkflowChange(classification)) {
  const status = await runNodeCheck('Workflow policy', 'scripts/check-workflow-policy.mjs');
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
    const status = await runNodeCheck(name, script, args, timeoutMs);
    results.push([name, status]);
    if (status !== 'PASS') process.exit(1);
  }
}

if (typecheckRequired) {
  const result = await runLocalBinaryDetailed(
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
console.log(`Outgoing signatures       ${isPrePush ? 'PASS' : 'SIGNING_HOOK_REQUIRED'}`);
console.log('Cloud validation required YES');
console.log(`Classification             ${classification.kind}`);
console.log(
  `TypeScript local tier     ${
    typecheckRequired
      ? full
        ? 'FULL (4 checkers)'
        : 'BOUNDED (1 checker)'
      : 'DEFERRED_TO_REQUIRED_CI'
  }`,
);
console.log(
  `LOCAL_ADMISSION_JSON ${JSON.stringify({
    classification,
    full,
    typecheckMode: typecheckRequired ? (full ? 'FULL' : 'BOUNDED') : 'DEFERRED_TO_REQUIRED_CI',
    isPrePush,
    results: Object.fromEntries(results),
    outgoingSignatures: isPrePush ? 'PASS' : 'SIGNING_HOOK_REQUIRED',
    cloudValidationRequired: true,
  })}`,
);
