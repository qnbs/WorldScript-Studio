import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import {
  containsSecretReference,
  hasAggregateResultAssertion,
  hasExecutableCloudTypecheckCommand,
  isDeploymentTimeConditionalIf,
  isReleasePublishingCommand,
  isSemanticallyUnconditionalIf,
} from './workflow-policy-guards.mjs';
import {
  asRecord,
  asStringList,
  collectValuesByKey,
  parseWorkflow,
  workflowJobs,
  workflowSteps,
} from './workflow-policy-parser.mjs';

const root = join(process.cwd(), '.github');
const workflowRoot = join(root, 'workflows');
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) collect(path);
    else if (/\.(?:yml|yaml)$/.test(entry)) files.push(path);
  }
}

collect(root);
// QNBS-v3: keep workflow governance checks offline and narrow so CI remains the authoritative execution gate.
const failures = [];
const parsedFiles = new Map();

function permissionValues(value) {
  if (typeof value === 'string') return [value];
  return Object.values(asRecord(value)).filter((entry) => typeof entry === 'string');
}

function hasReadOnlyTopLevelPermissions(workflow) {
  const permissions = workflow.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return false;
  return (
    permissions.contents === 'read' &&
    permissionValues(permissions).every((value) => ['none', 'read'].includes(value))
  );
}

function hasWriteAllPermissions(workflow) {
  return collectValuesByKey(workflow, 'permissions').some((value) =>
    permissionValues(value).some((permission) => permission.toLowerCase() === 'write-all'),
  );
}

function hasWriteCapability(workflow) {
  return collectValuesByKey(workflow, 'permissions').some((value) =>
    permissionValues(value).some((permission) => permission.toLowerCase().endsWith('write')),
  );
}

function actionReferences(workflow) {
  return collectValuesByKey(workflow, 'uses').filter((value) => typeof value === 'string');
}

function runBodies(workflow) {
  return workflowSteps(workflow)
    .map((step) => step.run)
    .filter((value) => typeof value === 'string');
}

for (const file of files) {
  const label = relative(process.cwd(), file);
  const content = readFileSync(file, 'utf8');
  let workflow;
  try {
    workflow = parseWorkflow(content, label);
    parsedFiles.set(file, workflow);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : `${label}: invalid YAML`);
    continue;
  }

  if (file.startsWith(workflowRoot) && !hasReadOnlyTopLevelPermissions(workflow))
    failures.push(`${label}: top-level permissions must include contents: read`);
  if (hasWriteAllPermissions(workflow)) failures.push(`${label}: write-all permissions`);

  // QNBS-v3: inspect parsed action references so comments, quotes, and flow mappings cannot bypass pinning.
  for (const reference of actionReferences(workflow)) {
    if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
    if (!/@[0-9a-f]{40}$/i.test(reference)) failures.push(`${label}: unpinned action ${reference}`);
  }
}

const ciPath = join(workflowRoot, 'ci.yml');
const ci = parsedFiles.get(ciPath);
if (!ci) failures.push('.github/workflows/ci.yml: workflow could not be parsed');
const ciJobs = new Map(workflowJobs(ci ?? {}));
const ciSuccess = asRecord(ciJobs.get('ci-success'));
const ciNeeds = asStringList(ciSuccess.needs);
const ciSuccessRuns = workflowSteps({ jobs: { 'ci-success': ciSuccess } })
  .map((step) => step.run)
  .filter((value) => typeof value === 'string');

// QNBS-v3: deployment-time conditionals also need an explicit aggregate disposition.
const explicitlyOutsideAggregateJobs = new Set(['deploy']);
for (const [jobName, job] of ciJobs) {
  if (jobName === 'ci-success') continue;
  const conditional = typeof job.if === 'string' && !isSemanticallyUnconditionalIf(job.if);
  const deploymentTimeConditional =
    typeof job.if === 'string' && isDeploymentTimeConditionalIf(job.if);
  const advisory = job['continue-on-error'] === true;
  const requiresDisposition = !conditional || deploymentTimeConditional;
  if (
    requiresDisposition &&
    !ciNeeds.includes(jobName) &&
    !advisory &&
    !explicitlyOutsideAggregateJobs.has(jobName)
  )
    failures.push(
      `.github/workflows/ci.yml: job ${jobName} lacks required/advisory/explicit-outside disposition`,
    );
}

const ciSource = readFileSync(ciPath, 'utf8').replace(/^\s*#.*$/gm, '');
if (!/name:\s*["']?✅ CI Success/.test(ciSource)) {
  failures.push('.github/workflows/ci.yml: missing required aggregate name');
}
const qualityRuns = workflowSteps({ jobs: { quality: asRecord(ciJobs.get('quality')) } })
  .map((step) => step.run)
  .filter((value) => typeof value === 'string');
if (!hasExecutableCloudTypecheckCommand(qualityRuns)) {
  failures.push('.github/workflows/ci.yml: missing full cloud TypeScript authority');
}

const requiredAggregateJobs = [
  'security',
  'signatures',
  'quality',
  'changes',
  'rust-tauri',
  'core-rust',
  'build',
  'e2e',
  'lighthouse',
  'vrt',
];
for (const dependency of requiredAggregateJobs) {
  if (!ciNeeds.includes(dependency))
    failures.push(`.github/workflows/ci.yml: ci-success missing ${dependency} dependency`);
}
for (const dependency of ciNeeds) {
  if (
    !hasAggregateResultAssertion(
      ciSuccessRuns,
      dependency,
      ['rust-tauri', 'core-rust'].includes(dependency),
    )
  )
    failures.push(`.github/workflows/ci.yml: ci-success does not assert ${dependency} result`);
}

const intelPath = join(workflowRoot, 'tauri-intel-qualification.yml');
if (files.includes(intelPath)) {
  const intel = parsedFiles.get(intelPath);
  const intelSource = readFileSync(intelPath, 'utf8');
  for (const [name, pattern] of [
    ['workflow dispatch', /workflow_dispatch:/],
    ['primary Intel runner', /macos-15-intel/],
    ['advisory Intel runner', /macos-26-intel/],
  ]) {
    if (!pattern.test(intelSource))
      failures.push(`${relative(process.cwd(), intelPath)}: missing ${name}`);
  }
  // QNBS-v3: capability isolation is authoritative; command scanning remains defense-in-depth.
  const intelRuns = intel ? runBodies(intel) : [];
  const intelRunSource = intelRuns.join('\n');
  if (
    (intel && hasWriteCapability(intel)) ||
    (intel && containsSecretReference(intel)) ||
    intelRunSource.includes('latest.json') ||
    intelRunSource.includes('softprops/action-gh-release') ||
    isReleasePublishingCommand(intelRuns)
  ) {
    failures.push(
      `${relative(process.cwd(), intelPath)}: qualification workflow may publish release state`,
    );
  }
}

if (failures.length > 0) {
  console.error('[workflow-policy] FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`[workflow-policy] PASS (${files.length} workflow/action files checked)`);
