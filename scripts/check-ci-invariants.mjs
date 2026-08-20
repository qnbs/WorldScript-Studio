#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_MANIFEST = resolve(ROOT, 'src-tauri/Cargo.toml');
const WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const CORE_ROOT = 'crates/';
const PROJECT_FIXTURES_ROOT = 'tests/fixtures/project-golden-masters/';

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWithin(filePath, root) {
  return filePath === root.replace(/\/$/, '') || filePath.startsWith(root);
}

function localTauriDependencyRoots() {
  const manifest = readFileSync(TAURI_MANIFEST, 'utf8');
  const pathValues = [...manifest.matchAll(/\bpath\s*=\s*"([^"]+)"/g)].map(([, value]) => value);
  const roots = new Set(['src-tauri/']);

  for (const value of pathValues) {
    const dependencyPath = normalizePath(relative(ROOT, resolve(dirname(TAURI_MANIFEST), value)));
    if (!dependencyPath || dependencyPath.startsWith('../')) {
      throw new Error(`Tauri path dependency escapes the repository: ${value}`);
    }
    roots.add(`${dependencyPath.split('/')[0]}/`);
  }

  return [...roots];
}

function classifyChangedFiles(files) {
  const changedFiles = files.map(normalizePath).filter(Boolean);
  const tauriRoots = localTauriDependencyRoots();
  const tauri = changedFiles.some(
    (filePath) => filePath === WORKFLOW_PATH || tauriRoots.some((root) => isWithin(filePath, root)),
  );
  const crates = changedFiles.some(
    (filePath) =>
      filePath === WORKFLOW_PATH ||
      isWithin(filePath, CORE_ROOT) ||
      isWithin(filePath, PROJECT_FIXTURES_ROOT),
  );

  return { tauri, crates };
}

function jobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${jobName}:`);
  if (start === -1) throw new Error(`Could not find CI job: ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function needsFor(workflow, jobName) {
  const block = jobBlock(workflow, jobName);
  const match = block.match(/^ {4}needs:\s*\[([^\]]+)\]/m);
  if (!match) throw new Error(`CI job ${jobName} must use an inline needs list`);
  return new Set(
    match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function checkWorkflowContract() {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const changes = jobBlock(workflow, 'changes');
  const aggregateNeeds = needsFor(workflow, 'ci-success');
  const deployNeeds = needsFor(workflow, 'deploy');

  for (const requiredJob of [
    'security',
    'quality',
    'changes',
    'rust-tauri',
    'core-rust',
    'build',
    'e2e',
    'vrt',
  ]) {
    assert(aggregateNeeds.has(requiredJob), `ci-success must include ${requiredJob}`);
  }
  assert(deployNeeds.has('ci-success'), 'deploy must depend on ci-success');
  assert(deployNeeds.has('build'), 'deploy must retain the build artifact dependency');
  assert.match(
    jobBlock(workflow, 'deploy'),
    /needs\.ci-success\.result\s*==\s*'success'/,
    'deploy must require a successful ci-success result',
  );
  assert.match(
    changes,
    /node scripts\/check-ci-invariants\.mjs --self-test --check-workflow/,
    'changes must execute the CI invariant self-check',
  );
  assert.match(
    changes,
    /node scripts\/check-ci-invariants\.mjs\s*>>\s*"\$GITHUB_OUTPUT"/,
    'changes must use the dependency-aware classifier for job outputs',
  );
}

function runSelfTests() {
  const cases = [
    [['src-tauri/src/lib.rs'], { tauri: true, crates: false }],
    [['crates/worldscript-project/src/lib.rs'], { tauri: true, crates: true }],
    [['crates/worldscript-project/Cargo.toml'], { tauri: true, crates: true }],
    [['crates/Cargo.lock'], { tauri: true, crates: true }],
    [[WORKFLOW_PATH], { tauri: true, crates: true }],
    [['components/App.tsx'], { tauri: false, crates: false }],
  ];

  for (const [files, expected] of cases) {
    assert.deepEqual(classifyChangedFiles(files), expected, `classification failed for ${files}`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) runSelfTests();
  if (args.has('--check-workflow')) checkWorkflowContract();
  if (args.has('--self-test') || args.has('--check-workflow')) return;

  const files = readFileSync(0, 'utf8').split(/\r?\n/);
  const result = classifyChangedFiles(files);
  process.stdout.write(`tauri=${result.tauri}\ncrates=${result.crates}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[ci-invariants] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
