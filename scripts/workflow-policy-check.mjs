import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAlias, LineCounter, parseDocument } from 'yaml';

function resolveProjectRoot() {
  try {
    return resolve(fileURLToPath(new URL('..', import.meta.url)));
  } catch {
    return process.cwd();
  }
}
const projectRoot = process.env.WORKFLOW_POLICY_ROOT
  ? resolve(process.env.WORKFLOW_POLICY_ROOT)
  : resolveProjectRoot();

// QNBS-v3: exempts only these exact job/write-key pairs from the no-unallowlisted-write policy.
const WRITE_SCOPE_ALLOWLIST = {
  'ci.yml': {
    build: new Set(['attestations', 'id-token']),
    deploy: new Set(['pages', 'id-token']),
    'pr-size': new Set(['pull-requests']),
  },
  'docker.yml': { 'build-push': new Set(['packages']) },
  'prune-deployments.yml': { prune: new Set(['deployments']) },
  'tauri-build.yml': { release: new Set(['contents']) },
  'codeql.yml': { analyze: new Set(['security-events']) },
  'scorecard.yml': { analysis: new Set(['security-events', 'id-token']) },
};

// QNBS-v3: contents:write is release/publish authority; only these jobs may hold it.
const PUBLISHING_ALLOWLIST = { 'tauri-build.yml': new Set(['release']) };

export function listWorkflowFiles(root = projectRoot, dependencies = {}) {
  const dir = join(root, '.github/workflows');
  const listDir = dependencies.readdirSync ?? readdirSync;
  if (!existsSync(dir)) return [];
  return listDir(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => join(dir, name));
}

// QNBS-v3: composite actions carry the same uses:-pin risk but have no jobs/permissions to check.
export function listActionFiles(root = projectRoot, dependencies = {}) {
  const dir = join(root, '.github/actions');
  const listDir = dependencies.readdirSync ?? readdirSync;
  if (!existsSync(dir)) return [];
  const results = [];
  // QNBS-v3: recurse any depth — a composite action can nest below its group directory.
  // QNBS-v3: a symlink here could redirect a governed action outside .github/actions unseen — reject it.
  const walk = (currentDir) => {
    for (const entry of listDir(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isSymbolicLink?.()) {
        throw new Error(`symlink not allowed under .github/actions: ${entryPath}`);
      } else if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name === 'action.yml' || entry.name === 'action.yaml') {
        results.push(entryPath);
      }
    }
  };
  walk(dir);
  return results.sort();
}

export function parseWorkflowFile(filePath, dependencies = {}) {
  const readFile = dependencies.readFileSync ?? readFileSync;
  const content = readFile(filePath, 'utf8');
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { uniqueKeys: true, lineCounter });
  return { filePath, content, doc, lineCounter };
}

// QNBS-v3: single alias-resolution point — every value read from a parsed tree must pass through here.
function resolveNode(node, doc) {
  return node && isAlias(node) ? node.resolve(doc) : node;
}

// QNBS-v3: resolves each job VALUE so an aliased whole job (ci-success: *base) isn't skipped downstream.
function jobMap(doc) {
  const jobs = doc.get('jobs', true);
  if (!jobs || typeof jobs.items === 'undefined') return new Map();
  const map = new Map();
  for (const pair of jobs.items) map.set(String(pair.key), resolveNode(pair.value, doc));
  return map;
}

// QNBS-v3: resolves a steps: node (possibly aliased) and each item in it (also possibly aliased).
function resolveSteps(stepsNode, doc) {
  const resolved = resolveNode(stepsNode, doc);
  const items = resolved?.items ?? [];
  return items.map((item) => resolveNode(item, doc));
}

function nodeValue(node, doc) {
  const resolved = resolveNode(node, doc);
  return resolved?.toJSON?.() ?? resolved?.value;
}

function findReviewerGovernanceGateStep(doc) {
  const workflowPolicyJob = jobMap(doc).get('workflow-policy');
  const steps = resolveSteps(workflowPolicyJob?.get?.('steps', true), doc);
  return steps.find(
    (step) =>
      nodeValue(step?.get?.('name', true), doc) === 'Reviewer governance configuration gate',
  );
}

function validateReviewerGovernanceGateStep(fileName, gateStep, failures) {
  if (gateStep) return true;
  failures.push({
    file: fileName,
    message: 'workflow-policy must retain the Reviewer governance configuration gate step',
  });
  return false;
}

function validateReviewerGovernanceGateRun(fileName, gateStep, doc, failures) {
  const run = nodeValue(gateStep.get('run', true), doc);
  if (
    typeof run !== 'string' ||
    !/node\s+"\$TRUSTED_BASE_WORKSPACE\/scripts\/check-reviewer-config\.mjs"/.test(run)
  ) {
    failures.push({
      file: fileName,
      message:
        'Reviewer governance configuration gate must invoke the exact trusted base checker command',
    });
  }
  if (
    typeof run !== 'string' ||
    !/REVIEWER_CONFIG_ROOT="\$\{\{\s*github\.workspace\s*\}\}"/.test(run)
  ) {
    failures.push({
      file: fileName,
      message: 'Reviewer governance configuration gate must use the exact PR workspace root',
    });
  }
  if (typeof run !== 'string' || !/REVIEWER_DEPENDENCY_ROOT="\$TRUSTED_BASE_WORKSPACE"/.test(run)) {
    failures.push({
      file: fileName,
      message: 'Reviewer governance configuration gate must use trusted dependency resolution',
    });
  }
}

function validateReviewerGovernanceGateEnvironment(fileName, gateStep, doc, failures) {
  const environment = nodeValue(gateStep.get('env', true), doc);
  const expectedWorkspace = '$' + '{{ github.workspace }}';
  if (environment?.REVIEWER_CONFIG_ROOT !== expectedWorkspace) {
    failures.push({
      file: fileName,
      message:
        'Reviewer governance configuration gate must pin REVIEWER_CONFIG_ROOT to the PR workspace',
    });
  }
}

function validateReviewerGovernanceGateOverrides(fileName, gateStep, failures) {
  for (const field of ['if', 'continue-on-error', 'shell', 'working-directory']) {
    if (gateStep.get(field, true) !== undefined) {
      failures.push({
        file: fileName,
        message: `Reviewer governance configuration gate must not override ${field}`,
      });
    }
  }
}

// QNBS-v3: the base-ref checker must reject removal or neutralization of the governance gate itself.
export function checkReviewerGovernanceGate(fileName, doc, failures) {
  if (fileName !== 'ci.yml') return;
  const gateStep = findReviewerGovernanceGateStep(doc);
  if (!validateReviewerGovernanceGateStep(fileName, gateStep, failures)) return;
  validateReviewerGovernanceGateRun(fileName, gateStep, doc, failures);
  validateReviewerGovernanceGateEnvironment(fileName, gateStep, doc, failures);
  validateReviewerGovernanceGateOverrides(fileName, gateStep, failures);
}

const MERGE_ADMISSION_STEP_NAME = 'Main-context merge admission proof';
// QNBS-v3: the admission proof lives in the cheap, already-required PR CHANGELOG guard so title edits re-run it without re-triggering or cancelling the heavyweight ci.yml pipeline.
const MERGE_ADMISSION_WORKFLOW = 'pr-changelog-reference.yml';
const MERGE_ADMISSION_JOB_ID = 'check';
const MERGE_ADMISSION_JOB_NAME =
  "Require this PR's own number in CHANGELOG.md [Unreleased] before merge";
const MERGE_ADMISSION_EVENT_TYPES = ['opened', 'edited', 'synchronize', 'reopened'];

function mapKeys(node, doc) {
  const resolved = resolveNode(node, doc);
  return (resolved?.items ?? []).map((pair) => String(pair.key?.value ?? pair.key));
}

function pushUnapprovedKeys(fileName, keys, allowed, label, failures) {
  for (const key of keys.filter((candidate) => !allowed.has(candidate))) {
    failures.push({ file: fileName, message: `${label} must not declare unapproved key ${key}` });
  }
}

function pullRequestTypes(doc) {
  const pullRequest = resolveNode(getWorkflowTriggerNode(doc)?.get?.('pull_request', true), doc);
  return nodeValue(pullRequest?.get?.('types', true), doc);
}

// QNBS-v3: only the checkout and a literal Node 22 pin may precede admission — SHA-pinned upstream actions that read no PR file, so nothing PR-controlled can alter its environment, PATH, or shell first.
const MERGE_ADMISSION_PRELUDE = [
  {
    uses: /^actions\/checkout@[0-9a-f]{40}$/,
    with: { 'persist-credentials': false, 'fetch-tags': true, 'fetch-depth': 0 },
  },
  { uses: /^actions\/setup-node@[0-9a-f]{40}$/, with: { 'node-version': '22' } },
];
const MERGE_ADMISSION_PRELUDE_STEP_KEYS = new Set(['uses', 'with']);

function checkMergeAdmissionPreludeStep(fileName, step, expected, doc, failures) {
  const label = `${MERGE_ADMISSION_WORKFLOW} step before ${MERGE_ADMISSION_STEP_NAME}`;
  const uses = String(nodeValue(step?.get?.('uses', true), doc) ?? '');
  if (!expected?.uses.test(uses)) {
    failures.push({
      file: fileName,
      message: `${label} must be the SHA-pinned checkout then setup-node prelude, found ${uses || 'a run step'}`,
    });
    return;
  }
  pushUnapprovedKeys(
    fileName,
    mapKeys(step, doc),
    MERGE_ADMISSION_PRELUDE_STEP_KEYS,
    label,
    failures,
  );
  const inputs = nodeValue(step.get('with', true), doc) ?? {};
  const expectedKeys = Object.keys(expected.with);
  const exact =
    Object.keys(inputs).length === expectedKeys.length &&
    expectedKeys.every((key) => inputs[key] === expected.with[key]);
  if (!exact) {
    failures.push({
      file: fileName,
      message: `${label} must use exactly ${JSON.stringify(expected.with)} as inputs`,
    });
  }
}

function checkMergeAdmissionStepOrder(fileName, steps, gateIndex, doc, failures) {
  if (gateIndex !== MERGE_ADMISSION_PRELUDE.length) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_STEP_NAME} must be step ${MERGE_ADMISSION_PRELUDE.length + 1} of ${MERGE_ADMISSION_WORKFLOW}, directly after the checkout and setup-node prelude`,
    });
  }
  steps.slice(0, gateIndex).forEach((step, index) => {
    checkMergeAdmissionPreludeStep(fileName, step, MERGE_ADMISSION_PRELUDE[index], doc, failures);
  });
}

// QNBS-v3: title edits change the prospective squash subject, so the guard must re-run on edited as well as on every head/base event.
function checkMergeAdmissionTrigger(fileName, doc, failures) {
  const types = pullRequestTypes(doc);
  const missing = MERGE_ADMISSION_EVENT_TYPES.filter(
    (type) => !Array.isArray(types) || !types.includes(type),
  );
  if (missing.length > 0) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_WORKFLOW} pull_request trigger must include ${missing.join(', ')} so head and title changes re-run admission`,
    });
  }
}

const MERGE_ADMISSION_JOB_KEYS = new Set(['name', 'runs-on', 'timeout-minutes', 'steps']);

// QNBS-v3: the job name is the required status context; job/workflow env, defaults, concurrency, if, container, and continue-on-error could rename, preload, cancel, skip, or tolerate the proof, so none may be declared.
function checkMergeAdmissionExecutionControls(fileName, job, doc, failures) {
  pushUnapprovedKeys(
    fileName,
    mapKeys(job, doc),
    MERGE_ADMISSION_JOB_KEYS,
    `${MERGE_ADMISSION_WORKFLOW} job`,
    failures,
  );
  if (nodeValue(job.get('name', true), doc) !== MERGE_ADMISSION_JOB_NAME) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_WORKFLOW} job must keep the required status context name "${MERGE_ADMISSION_JOB_NAME}"`,
    });
  }
  for (const key of ['env', 'defaults', 'concurrency', '<<']) {
    if (doc.get(key, true) !== undefined) {
      failures.push({
        file: fileName,
        message: `${MERGE_ADMISSION_WORKFLOW} must not declare workflow-level ${key}`,
      });
    }
  }
}

const MERGE_ADMISSION_STEP_KEYS = new Set(['name', 'env', 'run']);
const MERGE_ADMISSION_STEP_ENV = {
  BASE_SHA: '$' + '{{ github.event.pull_request.base.sha }}',
  PR_NUMBER: '$' + '{{ github.event.pull_request.number }}',
};

function checkMergeAdmissionStepShape(fileName, gateStep, doc, failures) {
  pushUnapprovedKeys(
    fileName,
    mapKeys(gateStep, doc),
    MERGE_ADMISSION_STEP_KEYS,
    MERGE_ADMISSION_STEP_NAME,
    failures,
  );
  const environment = nodeValue(gateStep.get('env', true), doc) ?? {};
  const keys = Object.keys(environment);
  const exact =
    keys.length === 2 && keys.every((key) => environment[key] === MERGE_ADMISSION_STEP_ENV[key]);
  if (!exact) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_STEP_NAME} env must be exactly BASE_SHA and PR_NUMBER bound to the pull-request event`,
    });
  }
}

const CANONICAL_MERGE_ADMISSION_RUN = [
  'set -euo pipefail',
  'git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"',
  'mkdir -p /tmp/base-scripts',
  'if git show "$BASE_SHA:scripts/check-merge-admission.mjs" > /tmp/base-scripts/check-merge-admission.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/check-doc-metrics.mjs" > /tmp/base-scripts/check-doc-metrics.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/i18n-locales.mjs" > /tmp/base-scripts/i18n-locales.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/test-metrics.mjs" > /tmp/base-scripts/test-metrics.mjs 2>/dev/null; then',
  'CHECKER=/tmp/base-scripts/check-merge-admission.mjs',
  'WORLDSCRIPT_REPOSITORY_ROOT="$GITHUB_WORKSPACE" node "$CHECKER"',
  'else',
  'if [ "$PR_NUMBER" = "857" ]; then',
  'echo "::notice::merge-admission evaluator is absent on the base ref; using the bounded PR #857 bootstrap once."',
  'test "$(sha256sum scripts/check-merge-admission.mjs | awk \'{print $1}\')" = "47689edebf7651f92ed9efb56ef80ff7648815201787a15c02f2e3a84a156b70"',
  'test "$(sha256sum scripts/check-doc-metrics.mjs | awk \'{print $1}\')" = "0ad96e40d206083b03867aca2474941cfeeedc608faacf3be5d2bad7753602ca"',
  'test "$(sha256sum scripts/i18n-locales.mjs | awk \'{print $1}\')" = "ae22dfcad13f0f82cfa8cbf39013422660a8e099e00dfa137266f2ccf5e40d58"',
  'test "$(sha256sum scripts/test-metrics.mjs | awk \'{print $1}\')" = "27992ffcaeea146d4ac64b64e9dcd6bc9420b9f895393e205bcab209c5764505"',
  'node scripts/check-merge-admission.mjs',
  'else',
  'echo "::error::trusted merge-admission evaluator is absent outside the introducing transition"',
  'exit 1',
  'fi',
  'fi',
];

function normalizedRunLines(run) {
  return typeof run === 'string'
    ? run
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

// QNBS-v3: exact canonical equality (not substring checks) so no early exit, wrapper, CHECKER reassignment, or widened bootstrap path can coexist with the trusted evaluator call.
function checkMergeAdmissionRun(fileName, gateStep, doc, failures) {
  const run = nodeValue(gateStep.get('run', true), doc);
  if (normalizedRunLines(run).join('\n') !== CANONICAL_MERGE_ADMISSION_RUN.join('\n')) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_STEP_NAME} must use the canonical trusted evaluator run; unreviewed control-flow variants are rejected`,
    });
  }
}

// QNBS-v3: body-only PR edits must never start or cancel the heavyweight pipeline; the separate cheap guard owns every edited-event revalidation.
function checkCiEditedIsolation(fileName, doc, failures) {
  const types = pullRequestTypes(doc);
  if (Array.isArray(types) && types.includes('edited')) {
    failures.push({
      file: fileName,
      message: `ci.yml must not run on pull_request edited; title-sensitive admission runs in ${MERGE_ADMISSION_WORKFLOW}`,
    });
  }
}

function checkMergeAdmissionWorkflow(fileName, doc, failures) {
  const job = jobMap(doc).get(MERGE_ADMISSION_JOB_ID);
  const steps = resolveSteps(job?.get?.('steps', true), doc);
  const gateIndex = steps.findIndex(
    (step) => nodeValue(step?.get?.('name', true), doc) === MERGE_ADMISSION_STEP_NAME,
  );
  if (gateIndex < 0) {
    failures.push({
      file: fileName,
      message: `${MERGE_ADMISSION_WORKFLOW} job ${MERGE_ADMISSION_JOB_ID} must retain the ${MERGE_ADMISSION_STEP_NAME} step`,
    });
    return;
  }
  checkMergeAdmissionStepOrder(fileName, steps, gateIndex, doc, failures);
  checkMergeAdmissionStepShape(fileName, steps[gateIndex], doc, failures);
  checkMergeAdmissionRun(fileName, steps[gateIndex], doc, failures);
  checkMergeAdmissionExecutionControls(fileName, job, doc, failures);
  checkMergeAdmissionTrigger(fileName, doc, failures);
}

// QNBS-v3: after introduction, the base-ref checker owns this contract; the evaluator may inspect the PR workspace only through the exact, bounded bootstrap path.
export function checkMergeAdmissionGate(fileName, doc, failures) {
  if (fileName === 'ci.yml') checkCiEditedIsolation(fileName, doc, failures);
  if (fileName === MERGE_ADMISSION_WORKFLOW) checkMergeAdmissionWorkflow(fileName, doc, failures);
}

function isPullRequestTargetOnlyTrigger(triggers) {
  if (!triggers) return false;
  if (typeof triggers !== 'object') return false;
  const triggerKeys = Object.keys(triggers);
  if (!triggerKeys.includes('pull_request_target')) return false;
  if (!triggerKeys.every((key) => key === 'pull_request_target')) return false;
  return hasRequiredReviewerTrustActivities(triggers.pull_request_target);
}

function hasRequiredReviewerTrustActivities(targetTrigger) {
  if (!targetTrigger) return false;
  if (typeof targetTrigger !== 'object') return false;
  if (!Object.keys(targetTrigger).every((key) => key === 'types')) return false;
  const types = targetTrigger.types;
  if (!Array.isArray(types)) return false;
  const requiredTypes = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited'];
  return requiredTypes.every((type) => types.includes(type));
}

function getWorkflowTriggerNode(doc) {
  const namedTrigger = doc.get('on', true);
  if (namedTrigger !== undefined) return namedTrigger;
  return doc.get(true, true);
}

function validateReviewerGovernanceTrustTrigger(fileName, doc, failures) {
  const triggerNode = getWorkflowTriggerNode(doc);
  const triggers = nodeValue(triggerNode, doc);
  if (!isPullRequestTargetOnlyTrigger(triggers)) {
    failures.push({
      file: fileName,
      message: 'reviewer governance trust workflow must be pull_request_target-only',
    });
  }
}

function validateReviewerGovernanceTrustExecution(fileName, doc, failures) {
  const job = jobMap(doc).get('reviewer-governance-trust');
  const steps = resolveSteps(job?.get?.('steps', true), doc);
  const validationStep = steps.find(
    (step) =>
      nodeValue(step?.get?.('name', true), doc) ===
      'Validate PR reviewer governance as untrusted data',
  );
  const run = nodeValue(validationStep?.get?.('run', true), doc);
  validateReviewerGovernanceTrustCheckout({ fileName, steps, validationStep, doc, failures });
  validateReviewerGovernanceTrustControls(fileName, job, validationStep, failures);
  validateReviewerGovernanceTrustShellDefaults(fileName, job, doc, failures);
  validateReviewerGovernanceTrustPreparation({
    fileName,
    steps,
    validationStep,
    doc,
    failures,
  });
  validateReviewerGovernanceTrustEnvironment(fileName, validationStep, doc, failures);
  if (!hasTrustedReviewerArchiveCommands(run)) {
    failures.push({
      file: fileName,
      message:
        'reviewer governance trust workflow must validate only an archived PR with trusted base code',
    });
  }
}

function validateReviewerGovernanceTrustShellDefaults(fileName, job, doc, failures) {
  for (const [scope, node] of [
    ['workflow', doc],
    ['job', job],
  ]) {
    const defaults = nodeValue(node?.get?.('defaults', true), doc);
    if (defaults?.run?.shell === undefined) continue;
    failures.push({
      file: fileName,
      message: `reviewer governance trust ${scope} must not define a run.shell default`,
    });
  }
}

function isCanonicalReviewerGovernanceTrustAction(uses) {
  return (
    typeof uses === 'string' &&
    ['actions/checkout@', 'pnpm/setup@', 'actions/setup-node@'].some((prefix) =>
      uses.startsWith(prefix),
    )
  );
}

function isCanonicalReviewerGovernanceTrustInstall(step, doc) {
  return (
    nodeValue(step?.get?.('name', true), doc) === 'Install trusted base dependencies' &&
    nodeValue(step?.get?.('run', true), doc) ===
      'pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile'
  );
}

function isCanonicalReviewerGovernanceTrustPreparationStep(step, doc) {
  return (
    isCanonicalReviewerGovernanceTrustAction(nodeValue(step?.get?.('uses', true), doc)) ||
    isCanonicalReviewerGovernanceTrustInstall(step, doc)
  );
}

function validateReviewerGovernanceTrustPreparation({
  fileName,
  steps,
  validationStep,
  doc,
  failures,
}) {
  const validationIndex = steps.indexOf(validationStep);
  if (validationIndex < 0) return;
  if (
    steps
      .slice(0, validationIndex)
      .every((step) => isCanonicalReviewerGovernanceTrustPreparationStep(step, doc))
  )
    return;
  failures.push({
    file: fileName,
    message:
      'reviewer governance trust must use only canonical preparation steps before validation',
  });
}

function findReviewerGovernanceTrustCheckouts(steps, doc) {
  return steps.flatMap((step, index) => {
    const uses = nodeValue(step?.get?.('uses', true), doc);
    return typeof uses === 'string' && uses.startsWith('actions/checkout@')
      ? [{ index, step }]
      : [];
  });
}

function getReviewerGovernanceTrustCheckoutFailure(checkouts, validationIndex) {
  if (checkouts.length !== 1) {
    return 'reviewer governance trust must contain exactly one checkout before validation';
  }
  if (checkouts[0].index >= validationIndex) {
    return 'reviewer governance trust must checkout the trusted base before validation';
  }
  return undefined;
}

function validateReviewerGovernanceTrustCheckout({
  fileName,
  steps,
  validationStep,
  doc,
  failures,
}) {
  const checkouts = findReviewerGovernanceTrustCheckouts(steps, doc);
  const validationIndex = steps.indexOf(validationStep);
  const checkoutFailure = getReviewerGovernanceTrustCheckoutFailure(checkouts, validationIndex);
  if (checkoutFailure !== undefined) {
    failures.push({
      file: fileName,
      message: checkoutFailure,
    });
    return;
  }
  const [checkout] = checkouts;
  validateReviewerGovernanceTrustCheckoutOptions({
    fileName,
    checkoutStep: checkout.step,
    doc,
    failures,
  });
}

function validateReviewerGovernanceTrustCheckoutOptions({ fileName, checkoutStep, doc, failures }) {
  const checkoutOptions = nodeValue(checkoutStep?.get?.('with', true), doc);
  for (const field of ['ref', 'repository']) {
    if (checkoutOptions?.[field] === undefined) continue;
    failures.push({
      file: fileName,
      message: `reviewer governance trust checkout must not override ${field}`,
    });
  }
}

function validateReviewerGovernanceTrustEnvironment(fileName, validationStep, doc, failures) {
  const environment = nodeValue(validationStep?.get?.('env', true), doc);
  validateReviewerGovernanceTrustEnvironmentValue({
    fileName,
    name: 'PR_NUMBER',
    actual: environment?.PR_NUMBER,
    expected: '$' + '{{ github.event.pull_request.number }}',
    failures,
  });
  validateReviewerGovernanceTrustEnvironmentValue({
    fileName,
    name: 'PR_BASE_SHA',
    actual: environment?.PR_BASE_SHA,
    expected: '$' + '{{ github.event.pull_request.base.sha }}',
    failures,
  });
  validateReviewerGovernanceTrustEnvironmentValue({
    fileName,
    name: 'PR_HEAD_SHA',
    actual: environment?.PR_HEAD_SHA,
    expected: '$' + '{{ github.event.pull_request.head.sha }}',
    failures,
  });
}

function validateReviewerGovernanceTrustEnvironmentValue({
  fileName,
  name,
  actual,
  expected,
  failures,
}) {
  if (actual === expected) return;
  failures.push({
    file: fileName,
    message: `reviewer governance trust step must bind ${name} to the exact pull_request event expression`,
  });
}

function validateReviewerGovernanceTrustControls(fileName, job, validationStep, failures) {
  validateReviewerGovernanceTrustNodeControls({
    fileName,
    scope: 'job',
    node: job,
    failures,
    fields: ['if', 'continue-on-error'],
  });
  validateReviewerGovernanceTrustNodeControls({
    fileName,
    scope: 'step',
    node: validationStep,
    failures,
    fields: ['if', 'continue-on-error', 'shell'],
  });
}

function validateReviewerGovernanceTrustNodeControls({ fileName, scope, node, failures, fields }) {
  if (!node) return;
  for (const field of fields) {
    if (node.get(field, true) === undefined) continue;
    failures.push({
      file: fileName,
      message: `reviewer governance trust ${scope} must not override ${field}`,
    });
  }
}

function hasTrustedReviewerFailFastPreamble(lines) {
  return lines.find((line) => line.length > 0) === 'set -euo pipefail';
}

function hasRequiredCommandsInOrder(lines, requiredCommands) {
  let previousIndex = -1;
  for (const command of requiredCommands) {
    const index = lines.indexOf(command, previousIndex + 1);
    if (index === -1) return false;
    previousIndex = index;
  }
  return true;
}

function hasNoSuccessfulReviewerTrustEscape(lines) {
  return !lines.some((line) => /\b(?:exit|return)\s+0\b|\bcontinue\b/.test(line));
}

function hasOnlyCanonicalReviewerTrustControlFlow(lines) {
  const allowed = new Set([
    'if [ "$FETCHED_HEAD" != "$PR_HEAD_SHA" ]; then',
    'if [ -n "$SYMLINKS" ]; then',
    'fi',
  ]);
  return !lines.some((line) => {
    if (!/^(?:if|then|else|elif|fi|for|while|case|esac)\b/.test(line)) return false;
    return !allowed.has(line);
  });
}

function hasTrustedReviewerArchiveCommands(run) {
  if (typeof run !== 'string') return false;
  const lines = run.split(/\r?\n/).map((line) => line.trim());
  const prExpression = '$' + '{PR_NUMBER}';
  const requiredCommands = [
    'git fetch --no-tags origin \\',
    `"refs/pull/${prExpression}/head:refs/remotes/origin/pr/${prExpression}"`,
    'git diff --quiet "$PR_BASE_SHA" "$PR_HEAD_SHA" -- scripts/check-reviewer-config.mjs scripts/workflow-policy-check.mjs || exit 1',
    'SYMLINKS="$(git ls-tree -r --full-tree "$PR_HEAD_SHA" -- | awk \'$1 == "120000" { print $0 }\')"',
    'if [ -n "$SYMLINKS" ]; then',
    'exit 1',
    `git archive "refs/remotes/origin/pr/${prExpression}" | tar -x -C "$PR_ROOT"`,
    'WORKFLOW_POLICY_ROOT="$PR_ROOT" \\',
    'node "$GITHUB_WORKSPACE/scripts/workflow-policy-check.mjs"',
    'REVIEWER_CONFIG_ROOT="$PR_ROOT" \\',
    'REVIEWER_DEPENDENCY_ROOT="$GITHUB_WORKSPACE" \\',
    'node scripts/check-reviewer-config.mjs',
  ];
  return (
    hasTrustedReviewerFailFastPreamble(lines) &&
    hasRequiredCommandsInOrder(lines, requiredCommands) &&
    hasNoSuccessfulReviewerTrustEscape(lines) &&
    hasOnlyCanonicalReviewerTrustControlFlow(lines)
  );
}

export function checkReviewerGovernanceTrustWorkflow(fileName, doc, failures) {
  if (fileName !== 'reviewer-governance-trust.yml') return;
  validateReviewerGovernanceTrustTrigger(fileName, doc, failures);
  validateReviewerGovernanceTrustExecution(fileName, doc, failures);
}

// QNBS-v3: resolves a needs: node (possibly aliased, e.g. shared via &deps/*deps) to a string array.
function resolveNeedsList(needsNode, doc) {
  const resolved = resolveNode(needsNode, doc);
  if (!resolved) return [];
  const value = resolved.toJSON();
  return Array.isArray(value) ? value : [value];
}

// QNBS-v3: an aliased *perms block resolves to Alias, not YAMLMap — must dereference before use.
function permissionEntries(node, doc) {
  const resolved = resolveNode(node, doc);
  if (!resolved) return null;
  if (typeof resolved.toJSON === 'function' && typeof resolved.items === 'undefined') {
    return { scalar: resolved.toJSON() };
  }
  const map = {};
  // QNBS-v3: a per-key value can itself be an alias (e.g. contents: *grant) — resolve each one too.
  for (const pair of resolved.items ?? []) {
    const value = resolveNode(pair.value, doc);
    map[String(pair.key)] = value !== undefined ? String(value) : String(pair.value);
  }
  return { map };
}

export function checkTopLevelPermissions(fileName, doc, failures) {
  const permissions = permissionEntries(doc.get('permissions', true), doc);
  if (!permissions) {
    failures.push({ file: fileName, message: 'missing top-level `permissions:` block' });
    return;
  }
  if (permissions.scalar !== undefined) {
    if (permissions.scalar !== 'read-all') {
      failures.push({
        file: fileName,
        message: `top-level permissions scalar must be "read-all", found "${permissions.scalar}"`,
      });
    }
    return;
  }
  const keys = Object.keys(permissions.map);
  if (keys.length !== 1 || permissions.map.contents !== 'read') {
    failures.push({
      file: fileName,
      message: 'top-level permissions must be exactly {contents: read} or the scalar "read-all"',
    });
  }
}

export function checkJobWriteScopeAllowlist(fileName, doc, failures) {
  const allowlist = WRITE_SCOPE_ALLOWLIST[fileName] ?? {};
  for (const [jobName, jobNode] of jobMap(doc)) {
    const permissions = permissionEntries(jobNode?.get?.('permissions', true), doc);
    if (!permissions) continue;
    // QNBS-v3: scalar write-all grants every scope at once, which no job's allowlist ever lists.
    if (permissions.scalar !== undefined) {
      if (permissions.scalar !== 'read-all') {
        failures.push({
          file: fileName,
          message: `job "${jobName}" declares scalar permissions "${permissions.scalar}", which is never allowlisted (only "read-all" is a valid job-level scalar)`,
        });
      }
      continue;
    }
    const allowedWrites = allowlist[jobName] ?? new Set();
    for (const [key, value] of Object.entries(permissions.map)) {
      if (value === 'write' && !allowedWrites.has(key)) {
        failures.push({
          file: fileName,
          message: `job "${jobName}" declares unallowlisted write permission "${key}"`,
        });
      }
    }
  }
}

export function checkNeedsGraph(fileName, doc, failures) {
  const jobs = jobMap(doc);
  const jobNames = new Set(jobs.keys());
  const needsOf = new Map();
  for (const [jobName, jobNode] of jobs) {
    const needs = resolveNeedsList(jobNode?.get?.('needs', true), doc);
    for (const dependency of needs) {
      if (!jobNames.has(dependency)) {
        failures.push({
          file: fileName,
          message: `job "${jobName}" needs unknown job "${dependency}"`,
        });
      }
    }
    needsOf.set(
      jobName,
      needs.filter((dependency) => jobNames.has(dependency)),
    );
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (jobName, path) => {
    if (visited.has(jobName)) return;
    if (visiting.has(jobName)) {
      failures.push({
        file: fileName,
        message: `needs graph cycle detected: ${[...path, jobName].join(' -> ')}`,
      });
      return;
    }
    visiting.add(jobName);
    for (const dependency of needsOf.get(jobName) ?? []) visit(dependency, [...path, jobName]);
    visiting.delete(jobName);
    visited.add(jobName);
  };
  for (const jobName of jobNames) visit(jobName, []);
}

function collectWorkflowSteps(doc) {
  const steps = [];
  for (const [, jobNode] of jobMap(doc)) {
    const stepsNode = jobNode?.get?.('steps', true);
    steps.push(...resolveSteps(stepsNode, doc));
  }
  return steps;
}

function collectActionSteps(doc) {
  const runsNode = resolveNode(doc.get('runs', true), doc);
  const stepsNode = runsNode?.get?.('steps', true);
  return resolveSteps(stepsNode, doc);
}

const DOCKER_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/;

// QNBS-v3: checks one uses: value, resolving aliases first so *ref hides no bypass step 6/2 found.
function checkUsesRef({ usesNode, containerNode, doc, fileName, lineCounter, failures }) {
  const resolvedNode = resolveNode(usesNode, doc);
  if (!resolvedNode || typeof resolvedNode.value !== 'string') return;
  const ref = resolvedNode.value;
  const line =
    lineCounter && Array.isArray(usesNode.range)
      ? lineCounter.linePos(usesNode.range[0]).line
      : undefined;
  const loc = line ? `line ${line}: ` : '';
  // QNBS-v3: build-from-source has no registry pin concept — already pinned by being in the commit.
  if (ref === 'Dockerfile') return;
  if (ref.startsWith('./')) {
    // QNBS-v3: only .github/actions/** is scanned by listActionFiles — any other local ref is unchecked.
    if (ref.startsWith('./.github/actions/')) return;
    failures.push({
      file: fileName,
      message: `${loc}local action reference "${ref}" is outside the governed .github/actions/ directory and is never pin-checked`,
    });
    return;
  }
  if (ref.startsWith('docker://')) {
    // QNBS-v3: a mutable docker tag is as unpinned as a floating action tag — require a digest.
    if (!DOCKER_DIGEST_PATTERN.test(ref)) {
      failures.push({
        file: fileName,
        message: `${loc}docker reference "${ref}" must pin an immutable @sha256 digest, not a mutable tag`,
      });
    }
    return;
  }
  const atIndex = ref.indexOf('@');
  if (atIndex === -1) {
    failures.push({
      file: fileName,
      message: `${loc}action reference "${ref}" is missing an @ pin`,
    });
    return;
  }
  const pin = ref.slice(atIndex + 1);
  if (!/^[0-9a-f]{40}$/.test(pin)) {
    failures.push({
      file: fileName,
      message: `${loc}action reference "${ref}" must pin a 40-hex-char SHA`,
    });
    return;
  }
  // QNBS-v3: an alias's comment can live at the anchor definition or the use site — accept either.
  const comment =
    usesNode.comment ??
    resolvedNode.comment ??
    (containerNode?.flow ? containerNode.comment : undefined);
  if (!comment || !/\S/.test(comment)) {
    failures.push({
      file: fileName,
      message: `${loc}SHA-pinned action "${ref}" is missing a trailing # comment`,
    });
  }
}

// QNBS-v3: walks the parsed tree (not raw text) so flow-mapping/alias steps can't bypass enforcement.
export function checkActionPins(fileName, doc, failures, options = {}) {
  const { fileKind = 'workflow', lineCounter } = options;
  const steps = fileKind === 'action' ? collectActionSteps(doc) : collectWorkflowSteps(doc);
  for (const step of steps) {
    const usesNode = step?.get?.('uses', true);
    if (!usesNode) continue;
    checkUsesRef({ usesNode, containerNode: step, doc, fileName, lineCounter, failures });
  }
  // QNBS-v3: a job can itself call a reusable workflow via jobs.<id>.uses — same pin risk as a step.
  if (fileKind === 'workflow') {
    for (const [, jobNode] of jobMap(doc)) {
      const usesNode = jobNode?.get?.('uses', true);
      if (!usesNode) continue;
      checkUsesRef({ usesNode, containerNode: jobNode, doc, fileName, lineCounter, failures });
    }
  }
  // QNBS-v3: a Docker action (runs.using: docker) has no steps — its own image: needs the same pin.
  if (fileKind === 'action') {
    const runsNode = resolveNode(doc.get('runs', true), doc);
    const imageNode = runsNode?.get?.('image', true);
    if (imageNode) {
      checkUsesRef({
        usesNode: imageNode,
        containerNode: runsNode,
        doc,
        fileName,
        lineCounter,
        failures,
      });
    }
  }
}

// QNBS-v3: always()/failure()/cancelled() (incl. negated !cancelled()) all bypass default success-gating.
const NON_DEFAULT_GATING_PATTERN = /\b(?:always|failure|cancelled)\s*\(\)/;

function jobHasNonDefaultGatingCondition(jobNode, doc) {
  const ifNode = resolveNode(jobNode?.get?.('if', true), doc);
  return typeof ifNode?.value === 'string' && NON_DEFAULT_GATING_PATTERN.test(ifNode.value);
}

const NEEDS_RESULT_PATTERN = /needs\.([A-Za-z0-9_-]+)\.result/g;
const FAILURE_EXIT_PATTERN = /\bexit\s+(?:\$\S+|[1-9]\d*)/;

// QNBS-v3: a whole-line shell comment can't affect control flow — strip before pattern-matching.
function stripCommentLines(script) {
  return script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

// QNBS-v3: text heuristic, not a shell parser — an exit in an unrelated branch can still false-pass.
function collectNeedsResultReferences(jobNode, doc) {
  const stepsNode = jobNode?.get?.('steps', true);
  const references = new Set();
  for (const step of resolveSteps(stepsNode, doc)) {
    const runNode = step?.get?.('run', true);
    if (typeof runNode?.value !== 'string') continue;
    const script = stripCommentLines(runNode.value);
    // QNBS-v3: a bare reference (e.g. echo) can't fail the job — only count it alongside a real exit.
    if (!FAILURE_EXIT_PATTERN.test(script)) continue;
    for (const match of script.matchAll(NEEDS_RESULT_PATTERN)) references.add(match[1]);
  }
  return references;
}

// QNBS-v3: excludes the full downstream closure (not just direct dependents) from ci-success.needs.
function computeAggregatorDescendants(jobs, doc) {
  const dependents = new Map();
  for (const [jobName, jobNode] of jobs) {
    const needs = resolveNeedsList(jobNode?.get?.('needs', true), doc);
    for (const dependency of needs) {
      if (!dependents.has(dependency)) dependents.set(dependency, []);
      dependents.get(dependency).push(jobName);
    }
  }
  const descendants = new Set();
  const queue = ['ci-success'];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const dependent of dependents.get(current) ?? []) {
      if (!descendants.has(dependent)) {
        descendants.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return descendants;
}

export function checkAggregatorNeeds(fileName, doc, failures) {
  const jobs = jobMap(doc);
  if (!jobs.has('ci-success')) return;
  const aggregatorNode = jobs.get('ci-success');
  // QNBS-v3: needs: quality (bare string) must not decompose into per-character Set entries.
  const declaredNeeds = new Set(resolveNeedsList(aggregatorNode?.get?.('needs', true), doc));
  const descendants = computeAggregatorDescendants(jobs, doc);
  const expectedNeeds = new Set();
  for (const [jobName, jobNode] of jobs) {
    if (jobName === 'ci-success') continue;
    const continueOnError = jobNode?.get?.('continue-on-error', true);
    if (continueOnError?.toJSON?.() === true) continue; // advisory job, not gating
    if (descendants.has(jobName)) continue; // downstream of the aggregator, direct or transitive
    expectedNeeds.add(jobName);
  }
  const missing = [...expectedNeeds].filter((name) => !declaredNeeds.has(name));
  const extra = [...declaredNeeds].filter((name) => !expectedNeeds.has(name));
  for (const name of missing) {
    failures.push({ file: fileName, message: `ci-success.needs is missing gating job "${name}"` });
  }
  for (const name of extra) {
    failures.push({
      file: fileName,
      message: `ci-success.needs lists "${name}", which is not a gating job (advisory or self-referential)`,
    });
  }
  if (jobHasNonDefaultGatingCondition(aggregatorNode, doc)) {
    const checkedResults = collectNeedsResultReferences(aggregatorNode, doc);
    for (const name of expectedNeeds) {
      if (declaredNeeds.has(name) && !checkedResults.has(name)) {
        failures.push({
          file: fileName,
          message: `ci-success's if: condition overrides default success-gating but its run steps never check needs.${name}.result — a failure of "${name}" would not fail the aggregator`,
        });
      }
    }
  }
}

// QNBS-v3: a tag-restricted ref check — allowlisting by name alone can't survive that gate loosening.
const TAG_ONLY_CONDITION_PATTERN = /refs\/tags\/|ref_type\s*==\s*['"]tag['"]/;

export function checkPublishingBoundary(fileName, doc, failures) {
  const allowlist = PUBLISHING_ALLOWLIST[fileName] ?? new Set();
  for (const [jobName, jobNode] of jobMap(doc)) {
    const permissions = permissionEntries(jobNode?.get?.('permissions', true), doc);
    // QNBS-v3: scalar write-all implicitly grants contents:write too — must not evade this check.
    const hasContentsWrite =
      permissions?.map?.contents === 'write' ||
      (permissions?.scalar !== undefined && permissions.scalar !== 'read-all');
    if (!hasContentsWrite) continue;
    if (!allowlist.has(jobName)) {
      failures.push({
        file: fileName,
        message: `job "${jobName}" declares contents:write but is not on the publishing allowlist`,
      });
      continue;
    }
    // QNBS-v3: allowlisting by name is only sound while the job itself stays tag-push-restricted.
    const ifNode = resolveNode(jobNode?.get?.('if', true), doc);
    if (typeof ifNode?.value !== 'string' || !TAG_ONLY_CONDITION_PATTERN.test(ifNode.value)) {
      failures.push({
        file: fileName,
        message: `publishing job "${jobName}" is on the allowlist but its if: condition no longer restricts it to a tag push — loosening or removing that condition would expose contents:write outside a verified release`,
      });
    }
  }
}

export function getTriggers(doc) {
  const on = doc.get('on', true) ?? doc.get(true, true);
  const triggers = { workflowDispatch: false, tagPush: false };
  if (!on) return triggers;
  const onValue = on.toJSON ? on.toJSON() : on;
  if (Array.isArray(onValue)) {
    triggers.workflowDispatch = onValue.includes('workflow_dispatch');
    return triggers;
  }
  if (onValue && typeof onValue === 'object') {
    triggers.workflowDispatch = 'workflow_dispatch' in onValue;
    const push = onValue.push;
    if (push && typeof push === 'object' && Array.isArray(push.tags) && push.tags.length > 0) {
      triggers.tagPush = true;
    }
  }
  return triggers;
}

export function checkWorkflowFile(filePath, dependencies = {}) {
  const fileName = basename(filePath);
  const failures = [];
  const { doc, lineCounter } = parseWorkflowFile(filePath, dependencies);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      failures.push({ file: fileName, message: `YAML parse error: ${error.message}` });
    }
    return failures; // QNBS-v3: structural checks below assume a parseable document.
  }
  checkTopLevelPermissions(fileName, doc, failures);
  checkJobWriteScopeAllowlist(fileName, doc, failures);
  checkNeedsGraph(fileName, doc, failures);
  checkActionPins(fileName, doc, failures, { fileKind: 'workflow', lineCounter });
  checkAggregatorNeeds(fileName, doc, failures);
  checkPublishingBoundary(fileName, doc, failures);
  checkReviewerGovernanceGate(fileName, doc, failures);
  checkMergeAdmissionGate(fileName, doc, failures);
  checkReviewerGovernanceTrustWorkflow(fileName, doc, failures);
  return failures;
}

// QNBS-v3: composite actions have no jobs/permissions — only the SHA-pin check applies to them.
export function checkActionFile(filePath, dependencies = {}) {
  const fileName = basename(filePath);
  const failures = [];
  const { doc, lineCounter } = parseWorkflowFile(filePath, dependencies);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      failures.push({ file: fileName, message: `YAML parse error: ${error.message}` });
    }
    return failures;
  }
  checkActionPins(fileName, doc, failures, { fileKind: 'action', lineCounter });
  return failures;
}

export function checkAllWorkflows(root = projectRoot, dependencies = {}) {
  const workflowFiles =
    dependencies.listWorkflowFiles?.(root) ?? listWorkflowFiles(root, dependencies);
  const requiredWorkflows = [
    [
      'reviewer-governance-trust.yml',
      'required reviewer governance trust workflow must remain present',
    ],
    ['ci.yml', 'canonical CI workflow must remain present for reviewer governance'],
    [
      'pr-changelog-reference.yml',
      'required PR CHANGELOG guard must remain present for main-context merge admission',
    ],
  ];
  const requiredWorkflowFailures = requiredWorkflows
    .filter(([fileName]) => {
      const requiredWorkflow = join(root, '.github/workflows', fileName);
      return !workflowFiles.some((filePath) => resolve(filePath) === resolve(requiredWorkflow));
    })
    .map(([file, message]) => ({ file, message }));
  // QNBS-v3: fail-closed — a rejected symlink must surface as a failure, never crash the whole check.
  let actionFiles;
  try {
    actionFiles = dependencies.listActionFiles?.(root) ?? listActionFiles(root, dependencies);
  } catch (error) {
    return [
      ...requiredWorkflowFailures,
      ...workflowFiles.flatMap((filePath) => checkWorkflowFile(filePath, dependencies)),
      { file: '.github/actions', message: error.message },
    ];
  }
  return [
    ...requiredWorkflowFailures,
    ...workflowFiles.flatMap((filePath) => checkWorkflowFile(filePath, dependencies)),
    ...actionFiles.flatMap((filePath) => checkActionFile(filePath, dependencies)),
  ];
}

export function main() {
  const failures = checkAllWorkflows(projectRoot);
  if (failures.length > 0) {
    console.error('Workflow-policy check failed:');
    for (const failure of failures) console.error(`- [${failure.file}] ${failure.message}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Workflow-policy check passed: permissions, needs graph, action pins, aggregator sync, and publishing boundary are all structurally sound.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
