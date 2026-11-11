#!/usr/bin/env node
/**
 * #911 release security gate. Every publishing job (Tauri `release`, GHCR `build-push`) and the
 * non-publishing proof stand-in must run only after an exact-ref OSV audit of the commit it would
 * publish. The audit job is inlined in each workflow (the trusted workflow-policy checker on main
 * rejects local reusable-workflow calls, and PRs cannot change that checker). This module checks
 * the inlined jobs and the publish conditions; tests/unit/tooling/releaseSecurityGate.test.ts runs
 * it on the shipped workflows in CI, with negative fixtures.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const expression = (inner) => `\${{ ${inner} }}`;

export const GITHUB_SHA = expression('github.sha');
export const PROOF_INPUT_SHA = expression('inputs.expected-sha');
export const AUDITED_SHA_OUTPUT = expression('steps.result.outputs.audited-sha');

export const REQUIRED_TAG_PUSH_CONDITIONS = Object.freeze([
  "github.event_name == 'push'",
  "github.ref_type == 'tag'",
  "startsWith(github.ref, 'refs/tags/v')",
]);

// QNBS-v3: GHCR and Tauri publish only behind the same trusted-verifier proof of the pushed tag; tag protection is checked inside that verifier, not via github.ref_protected.
export const REQUIRED_VERIFIED_TAG_PUBLISH_CONDITIONS = Object.freeze([
  ...REQUIRED_TAG_PUSH_CONDITIONS,
  "needs.verify-release-tag.result == 'success'",
  'needs.verify-release-tag.outputs.verified-tag-sha == github.sha',
]);

export const REQUIRED_PROOF_SIMULATION_CONDITIONS = Object.freeze([
  "github.event_name == 'workflow_dispatch'",
  "inputs.simulated_event == 'push'",
  "inputs.simulated_ref_type == 'tag'",
  "startsWith(inputs.simulated_ref, 'refs/tags/v')",
  "inputs.simulated_tag_signature == 'verified'",
]);

// QNBS-v3 (#1219): GHCR and Tauri publish only after the same exact-commit container build check, so one missing or failed build check stops both channels instead of leaving a partial release.
export const CONTAINER_PRECHECK_JOB = 'container-precheck';
export const REQUIRED_CONTAINER_PRECHECK_CONDITIONS = Object.freeze([
  "needs.container-precheck.result == 'success'",
  'needs.container-precheck.outputs.prechecked-sha == github.sha',
]);
export const CONTAINER_PRECHECK_RUN =
  'node scripts/release-container-precheck.mjs --wait-seconds 1200 "$GITHUB_SHA"';
const CONTAINER_PRECHECK_RECORD = 'echo "prechecked-sha=$GITHUB_SHA" >> "$GITHUB_OUTPUT"';
const PUBLISH_CONDITIONS_WITH_PRECHECK = Object.freeze([
  ...REQUIRED_VERIFIED_TAG_PUBLISH_CONDITIONS,
  ...REQUIRED_CONTAINER_PRECHECK_CONDITIONS,
]);

/** Workflow → the jobs that publish (or stand in for publishing) and the SHA their audit must check. */
export const RELEASE_GATED_WORKFLOWS = Object.freeze({
  'tauri-build.yml': {
    gatedJobs: ['release'],
    expectedSha: GITHUB_SHA,
    requiredEventConditions: PUBLISH_CONDITIONS_WITH_PRECHECK,
    requiredNeeds: ['verify-release-tag', CONTAINER_PRECHECK_JOB],
    verifyTagJob: true,
    containerPrecheckJob: true,
    exactCheckoutRef: GITHUB_SHA,
    bundleJobs: ['bundle'],
  },
  'docker.yml': {
    gatedJobs: ['build-push'],
    expectedSha: GITHUB_SHA,
    requiredEventConditions: PUBLISH_CONDITIONS_WITH_PRECHECK,
    requiredNeeds: ['verify-release-tag', CONTAINER_PRECHECK_JOB],
    verifyTagJob: true,
    containerPrecheckJob: true,
    exactCheckoutRef: GITHUB_SHA,
  },
  'release-gate-proof.yml': {
    gatedJobs: ['publish-stand-in'],
    expectedSha: PROOF_INPUT_SHA,
    requiredEventConditions: REQUIRED_PROOF_SIMULATION_CONDITIONS,
  },
});

// QNBS-v3 (#1206): bundle holds the updater signing secrets; manual builds stay allowed, tag builds need the verifier proof.
export const TAURI_BUNDLE_CONDITION =
  "always() && !cancelled() && needs.parity-preflight.result == 'success' && ( github.event_name == 'workflow_dispatch' || ( needs.verify-release-tag.result == 'success' && needs.verify-release-tag.outputs.verified-tag-sha == github.sha ) )";
export const TAURI_BUNDLE_NEEDS = Object.freeze(['verify-release-tag', 'parity-preflight']);

export const REQUIRED_GATE_CONDITIONS = Object.freeze([
  "needs.security-audit.result == 'success'",
  'needs.security-audit.outputs.audited-sha == github.sha',
]);

export const REQUIRED_SCAN_ARGS = Object.freeze([
  '--config=src-tauri/osv-scanner.toml',
  '--lockfile=pnpm-lock.yaml',
  '--lockfile=src-tauri/Cargo.lock',
  '--lockfile=crates/Cargo.lock',
]);

// A status function in a job `if` replaces the implicit success() requirement on its needs.
const STATUS_FUNCTION = /\b(?:always|failure|cancelled|success)\s*\(/;
const CHECKOUT = 'actions/checkout@';
const CHECKOUT_PIN = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const OSV_SCANNER = 'google/osv-scanner-action/osv-scanner-action@';
const TAG_VERIFIER = 'node scripts/signing/verify-github-signatures.mjs';
const TAG_VERIFIER_SCRIPT = 'scripts/signing/verify-github-signatures.mjs';
const TAG_VERIFIER_SOURCE_SHA = 'd46ae7969b6a8034de0c998ac3376e4fb7474f4a';

function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function permissionsAreReadOnlyContents(permissions) {
  return (
    permissions !== null &&
    typeof permissions === 'object' &&
    Object.keys(permissions).length === 1 &&
    permissions.contents === 'read'
  );
}

function hasWritePermission(job) {
  const permissions = job?.permissions;
  if (typeof permissions === 'string') return permissions !== 'read-all';
  return Object.values(permissions ?? {}).includes('write');
}

const runOf = (step) => String(step?.run ?? '');
const usesOf = (step) => String(step?.uses ?? '');

/** Locates each required audit step; -1 when missing. */
function locateAuditSteps(steps) {
  return {
    validate: steps.findIndex((step) => /\^\[0-9a-f\]\{40\}\$/.test(runOf(step))),
    checkout: steps.findIndex((step) => usesOf(step).startsWith(CHECKOUT)),
    provenance: steps.findIndex((step) =>
      /git rev-parse HEAD[\s\S]*"\$EXPECTED_SHA"/.test(runOf(step)),
    ),
    scan: steps.findIndex((step) => usesOf(step).startsWith(OSV_SCANNER)),
    result: steps.findIndex((step) => step.id === 'result'),
  };
}

function isStrictlyIncreasing(indexes) {
  return indexes.every((index, i) => index >= 0 && (i === 0 || index > indexes[i - 1]));
}

function checkScanArgs(scanStep, fail) {
  const args = String(scanStep?.with?.['scan-args'] ?? '')
    .split('\n')
    .map((line) => line.trim());
  for (const arg of REQUIRED_SCAN_ARGS) {
    if (!args.includes(arg)) fail(`the OSV scan must include ${arg}`);
  }
}

// A step-level `if` can skip a check and `continue-on-error` turns a failed check into success; either would let the audit pass without auditing.
function checkStepsAlwaysEnforced(steps, fail) {
  for (const step of steps) {
    if (step?.if !== undefined)
      fail(`audit step "${step.name ?? step.uses ?? step.id}" must not have an if:`);
    if (step?.['continue-on-error'] !== undefined) {
      fail(`audit step "${step.name ?? step.uses ?? step.id}" must not set continue-on-error`);
    }
  }
}

function checkAuditSteps(steps, expectedSha, fail) {
  const found = locateAuditSteps(steps);
  if (found.validate < 0)
    fail('the audit must reject an expected SHA that is not 40 hex characters');
  if (steps[found.checkout]?.with?.ref !== expectedSha) {
    fail(`the audit checkout must use ref: ${expectedSha}`);
  }
  if (found.provenance < 0) fail('the audit must verify the checked-out HEAD equals EXPECTED_SHA');
  checkScanArgs(steps[found.scan], fail);
  const order = [found.validate, found.checkout, found.provenance, found.scan, found.result];
  if (!isStrictlyIncreasing(order)) {
    fail(
      'the audit steps must run validate → checkout → provenance → scan → record, in that order',
    );
  }
  if (!/git rev-parse HEAD/.test(runOf(steps[found.result]))) {
    fail('the audited-sha output must be recorded from git rev-parse HEAD');
  }
  checkStepsAlwaysEnforced(steps, fail);
}

/** [passes(audit, expectedSha), message(expectedSha)] for the audit job's own settings. */
const AUDIT_JOB_RULES = [
  [
    (audit) => permissionsAreReadOnlyContents(audit.permissions),
    () => 'job "security-audit" must hold exactly permissions: { contents: read }',
  ],
  [
    (audit, sha) => audit.env?.EXPECTED_SHA === sha,
    (sha) => `job "security-audit" must audit EXPECTED_SHA: ${sha}`,
  ],
  [
    (audit) => audit.outputs?.['audited-sha'] === AUDITED_SHA_OUTPUT,
    () => `job "security-audit" must output audited-sha: ${AUDITED_SHA_OUTPUT}`,
  ],
  [
    (audit) => audit['continue-on-error'] === undefined,
    () => 'job "security-audit" must not set continue-on-error',
  ],
];

function checkAuditJob(audit, expectedSha, fail) {
  if (!audit) {
    fail('missing job "security-audit" (#911 release gate)');
    return;
  }
  for (const [passes, message] of AUDIT_JOB_RULES) {
    if (!passes(audit, expectedSha)) fail(message(expectedSha));
  }
  checkAuditSteps(asList(audit.steps), expectedSha, fail);
}

function normalizedCondition(condition) {
  return condition
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/\s+/g, ' ');
}

function checkExactCondition(jobName, condition, requiredConditions, fail) {
  const actual = normalizedCondition(condition);
  const missing = requiredConditions.filter((predicate) => !actual.includes(predicate));
  for (const predicate of missing) {
    fail(`job "${jobName}" if: must require ${predicate}`);
  }
  // QNBS-v3: exact conjunction checks prevent alternate OR branches bypassing release gates.
  if (actual.includes('||')) {
    fail(`job "${jobName}" if: must not contain a permissive OR branch`);
  }
  const expected = requiredConditions.join(' && ');
  if (actual !== expected) {
    fail(`job "${jobName}" if: must equal the exact fail-closed condition "${expected}"`);
  }
  if (STATUS_FUNCTION.test(actual)) {
    fail(
      `job "${jobName}" if: must not use a status function; it would let the job run after a failed, skipped or cancelled audit`,
    );
  }
}

function checkGateCondition(jobName, condition, fail, requiredEventConditions = []) {
  checkExactCondition(
    jobName,
    condition,
    [...requiredEventConditions, ...REQUIRED_GATE_CONDITIONS],
    fail,
  );
}

const TAG_VERIFIER_ENV = Object.freeze({
  GITHUB_EVENT_NAME: expression('github.event_name'),
  GITHUB_EVENT_PATH: expression('github.event_path'),
  GITHUB_REF_NAME: expression('github.ref_name'),
  GITHUB_REF_TYPE: expression('github.ref_type'),
  GITHUB_REPOSITORY: expression('github.repository'),
  GITHUB_SHA: expression('github.sha'),
  GITHUB_TOKEN: expression('github.token'),
});

const TAG_VERIFIER_RUN = [
  'set -euo pipefail && env -i PATH="$PATH"',
  ...Object.keys(TAG_VERIFIER_ENV).map((key) => `${key}="$${key}"`),
  `${TAG_VERIFIER} && echo "verified-tag-sha=$GITHUB_SHA" >> "$GITHUB_OUTPUT"`,
].join(' ');

function checkTagVerifierCheckout(steps, fail) {
  const checkoutIndex = steps.findIndex((step) => usesOf(step) === CHECKOUT_PIN);
  if (checkoutIndex < 0) {
    fail(`job "verify-release-tag" must use the pinned ${CHECKOUT_PIN} action`);
    return -1;
  }
  const checkout = steps[checkoutIndex];
  if (
    checkout.with?.ref !== TAG_VERIFIER_SOURCE_SHA ||
    checkout.with?.path !== 'trusted-verifier' ||
    checkout.with?.['fetch-depth'] !== 1 ||
    checkout.with?.['persist-credentials'] !== false ||
    checkout.env !== undefined
  ) {
    fail(
      `job "verify-release-tag" must check out the immutable trusted verifier ${TAG_VERIFIER_SOURCE_SHA} without credentials`,
    );
  }
  return checkoutIndex;
}

function checkTagVerifierStep(steps, checkoutIndex, fail) {
  const verifyIndex = steps.findIndex((step) => runOf(step).includes(TAG_VERIFIER_SCRIPT));
  if (verifyIndex < 0) {
    fail(`job "verify-release-tag" must invoke ${TAG_VERIFIER} from the trusted checkout`);
    return;
  }
  const verifier = steps[verifyIndex];
  if (verifier.id !== 'verify') {
    fail('job "verify-release-tag" must expose the successful verifier step as "verify"');
  }
  const expectedKeys = Object.keys(TAG_VERIFIER_ENV).sort();
  const actualKeys = Object.keys(verifier.env ?? {}).sort();
  const hasRealEventContext = Object.entries(TAG_VERIFIER_ENV).every(
    ([key, value]) => verifier.env?.[key] === value,
  );
  if (
    !hasRealEventContext ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(
      'job "verify-release-tag" must pass only the allowlisted real tag-push environment to the signature verifier',
    );
  }
  if (
    runOf(verifier).trim().replace(/\s+/g, ' ') !== TAG_VERIFIER_RUN ||
    verifier['working-directory'] !== 'trusted-verifier' ||
    verifier.shell !== 'bash'
  ) {
    fail(
      'job "verify-release-tag" must run the pinned verifier from its trusted checkout with a clean environment',
    );
  }
  if (checkoutIndex >= 0 && verifyIndex <= checkoutIndex) {
    fail(
      'job "verify-release-tag" must check out the trusted verifier before signature verification',
    );
  }
}

function checkTagVerifierJob(job, fail) {
  if (!job) {
    fail('missing job "verify-release-tag"');
    return;
  }
  checkExactCondition(
    'verify-release-tag',
    String(job.if ?? ''),
    REQUIRED_TAG_PUSH_CONDITIONS,
    fail,
  );
  if (!permissionsAreReadOnlyContents(job.permissions)) {
    fail('job "verify-release-tag" must have exactly permissions: contents: read');
  }
  if (job['continue-on-error'] !== undefined) {
    fail('job "verify-release-tag" must not set continue-on-error');
  }
  if (job.outputs?.['verified-tag-sha'] !== expression('steps.verify.outputs.verified-tag-sha')) {
    fail('job "verify-release-tag" must expose only the verified tag target SHA');
  }
  if (job.env !== undefined || job.container !== undefined || job.services !== undefined) {
    fail('job "verify-release-tag" must not inherit environment or container injection');
  }
  const steps = asList(job.steps);
  if (steps.length !== 2) {
    fail('job "verify-release-tag" must contain only the pinned checkout and verifier steps');
  }
  const checkoutIndex = checkTagVerifierCheckout(steps, fail);
  checkTagVerifierStep(steps, checkoutIndex, fail);
  checkStepsAlwaysEnforced(steps, fail);
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const onlyKeys = (value, allowed) =>
  value !== null &&
  typeof value === 'object' &&
  Object.keys(value).every((key) => allowed.includes(key));

/** The three canonical steps of the container precheck, each with only its allowed keys. */
const CONTAINER_PRECHECK_STEPS = [
  (step) =>
    onlyKeys(step, ['name', 'uses', 'with']) &&
    usesOf(step) === CHECKOUT_PIN &&
    sameJson(step.with, { ref: GITHUB_SHA, 'persist-credentials': false }),
  (step) =>
    onlyKeys(step, ['name', 'env', 'run']) &&
    runOf(step) === CONTAINER_PRECHECK_RUN &&
    sameJson(step.env, { GH_TOKEN: expression('github.token') }),
  (step) =>
    onlyKeys(step, ['name', 'id', 'run']) &&
    step.id === 'result' &&
    runOf(step) === CONTAINER_PRECHECK_RECORD,
];

/** [passes(job), message] for the read-only container precheck job that both publishing workflows share. */
const CONTAINER_PRECHECK_RULES = [
  [
    (job) =>
      onlyKeys(job, ['name', 'runs-on', 'timeout-minutes', 'permissions', 'outputs', 'steps']),
    `job "${CONTAINER_PRECHECK_JOB}" must not set if, needs, env, continue-on-error, container or services`,
  ],
  [
    (job) => sameJson(job.permissions, { contents: 'read', actions: 'read' }),
    `job "${CONTAINER_PRECHECK_JOB}" must hold exactly permissions: { contents: read, actions: read }`,
  ],
  [
    (job) =>
      sameJson(job.outputs, {
        'prechecked-sha': expression('steps.result.outputs.prechecked-sha'),
      }),
    `job "${CONTAINER_PRECHECK_JOB}" must expose only prechecked-sha from its result step`,
  ],
  [
    (job) => {
      const steps = asList(job.steps);
      return (
        steps.length === CONTAINER_PRECHECK_STEPS.length &&
        CONTAINER_PRECHECK_STEPS.every((canonical, index) => canonical(steps[index]))
      );
    },
    `job "${CONTAINER_PRECHECK_JOB}" must run exactly the pinned exact-commit checkout, "${CONTAINER_PRECHECK_RUN}" and the record step`,
  ],
];

function checkContainerPrecheckJob(job, fail) {
  if (!job) {
    fail(`missing job "${CONTAINER_PRECHECK_JOB}" (#1219 release gate)`);
    return;
  }
  for (const [passes, message] of CONTAINER_PRECHECK_RULES) {
    if (!passes(job)) fail(message);
  }
}

// QNBS-v3: a writer must act on the audited commit, not on a tag ref that could move after the audit.
function checkGatedCheckouts(jobName, job, exactCheckoutRef, fail) {
  const checkouts = asList(job.steps).filter((step) => usesOf(step).startsWith(CHECKOUT));
  const onExactRef =
    checkouts.length > 0 && checkouts.every((checkout) => checkout.with?.ref === exactCheckoutRef);
  if (!onExactRef) fail(`job "${jobName}" must check out ref: ${exactCheckoutRef}`);
}

function checkGatedJob(jobName, job, fail, spec) {
  if (!job) {
    fail(`gated job "${jobName}" is missing`);
    return;
  }
  const needs = asList(job.needs);
  for (const required of ['security-audit', ...(spec.requiredNeeds ?? [])]) {
    if (!needs.includes(required)) fail(`job "${jobName}" must need "${required}"`);
  }
  checkGateCondition(jobName, String(job.if ?? ''), fail, spec.requiredEventConditions);
  if (spec.exactCheckoutRef) checkGatedCheckouts(jobName, job, spec.exactCheckoutRef, fail);
}

function checkBundleJob(jobName, job, expectedSha, fail) {
  if (!job) {
    fail(`bundle job "${jobName}" is missing`);
    return;
  }
  const needs = asList(job.needs);
  for (const required of TAURI_BUNDLE_NEEDS) {
    if (!needs.includes(required)) fail(`job "${jobName}" must need "${required}"`);
  }
  if (normalizedCondition(String(job.if ?? '')) !== TAURI_BUNDLE_CONDITION) {
    fail(
      `job "${jobName}" if: must equal the exact fail-closed condition "${TAURI_BUNDLE_CONDITION}"`,
    );
  }
  checkGatedCheckouts(jobName, job, expectedSha, fail);
}

function checkNoUngatedWriters(jobs, gatedJobs, fail) {
  const ungated = Object.entries(jobs).filter(
    ([jobName, job]) => !gatedJobs.includes(jobName) && hasWritePermission(job),
  );
  for (const [jobName] of ungated) {
    fail(
      `job "${jobName}" holds a write permission but is not behind the #911 release security gate`,
    );
  }
}

function parseWorkflow(source) {
  try {
    return { workflow: parse(source), error: null };
  } catch (error) {
    return { workflow: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Failures for one gated workflow, given its file name and source text. */
export function checkReleaseSecurityWorkflow(fileName, source) {
  const spec = RELEASE_GATED_WORKFLOWS[fileName];
  if (!spec) return [];
  const failures = [];
  const fail = (message) => failures.push({ file: fileName, message });
  const { workflow, error } = parseWorkflow(source);
  if (error !== null) {
    fail(`YAML parse error: ${error}`);
    return failures;
  }
  const jobs = workflow?.jobs ?? {};
  if (spec.verifyTagJob && workflow?.env !== undefined) {
    fail('Release workflow must not define inherited environment variables');
  }
  checkAuditJob(jobs['security-audit'], spec.expectedSha, fail);
  if (spec.verifyTagJob) checkTagVerifierJob(jobs['verify-release-tag'], fail);
  if (spec.containerPrecheckJob) checkContainerPrecheckJob(jobs[CONTAINER_PRECHECK_JOB], fail);
  for (const jobName of spec.gatedJobs) {
    checkGatedJob(jobName, jobs[jobName], fail, spec);
  }
  for (const jobName of spec.bundleJobs ?? []) {
    checkBundleJob(jobName, jobs[jobName], spec.expectedSha, fail);
  }
  checkNoUngatedWriters(jobs, spec.gatedJobs, fail);
  return failures;
}

function readWorkflow(root, fileName) {
  try {
    return readFileSync(join(root, '.github', 'workflows', fileName), 'utf8');
  } catch {
    return null;
  }
}

export function checkReleaseSecurityGates(
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
) {
  return Object.keys(RELEASE_GATED_WORKFLOWS).flatMap((fileName) => {
    const source = readWorkflow(root, fileName);
    if (source === null) return [{ file: fileName, message: 'gated workflow is missing' }];
    return checkReleaseSecurityWorkflow(fileName, source);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const failures = checkReleaseSecurityGates();
  for (const failure of failures) console.error(`- [${failure.file}] ${failure.message}`);
  if (failures.length > 0) process.exit(1);
  console.log('[release-security-gate] every publishing job waits on an exact-ref audit');
}
