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

/** Workflow → the jobs that publish (or stand in for publishing) and the SHA their audit must check. */
export const RELEASE_GATED_WORKFLOWS = Object.freeze({
  'tauri-build.yml': { gatedJobs: ['release'], expectedSha: GITHUB_SHA },
  'docker.yml': { gatedJobs: ['build-push'], expectedSha: GITHUB_SHA },
  'release-gate-proof.yml': { gatedJobs: ['publish-stand-in'], expectedSha: PROOF_INPUT_SHA },
});

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
const OSV_SCANNER = 'google/osv-scanner-action/osv-scanner-action@';

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

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

function checkAuditSteps(steps, expectedSha, fail) {
  const validate = steps.findIndex((step) => /\^\[0-9a-f\]\{40\}\$/.test(String(step.run ?? '')));
  const checkout = steps.findIndex((step) => String(step.uses ?? '').startsWith(CHECKOUT));
  const provenance = steps.findIndex((step) =>
    /git rev-parse HEAD[\s\S]*"\$EXPECTED_SHA"/.test(String(step.run ?? '')),
  );
  const scan = steps.findIndex((step) => String(step.uses ?? '').startsWith(OSV_SCANNER));
  const result = steps.findIndex((step) => step.id === 'result');

  if (validate < 0) fail('the audit must reject an expected SHA that is not 40 hex characters');
  if (checkout < 0 || steps[checkout]?.with?.ref !== expectedSha) {
    fail(`the audit checkout must use ref: ${expectedSha}`);
  }
  if (provenance < 0) fail('the audit must verify the checked-out HEAD equals EXPECTED_SHA');
  const args = String(steps[scan]?.with?.['scan-args'] ?? '')
    .split('\n')
    .map((line) => line.trim());
  for (const arg of REQUIRED_SCAN_ARGS) {
    if (!args.includes(arg)) fail(`the OSV scan must include ${arg}`);
  }
  const ordered = [validate, checkout, provenance, scan, result];
  if (
    ordered.some((index) => index < 0) ||
    ordered.some((index, i) => i > 0 && index <= ordered[i - 1])
  ) {
    fail(
      'the audit steps must run validate → checkout → provenance → scan → record, in that order',
    );
  }
  if (!/git rev-parse HEAD/.test(String(steps[result]?.run ?? ''))) {
    fail('the audited-sha output must be recorded from git rev-parse HEAD');
  }
}

function checkAuditJob(audit, expectedSha, fail) {
  if (!audit) {
    fail('missing job "security-audit" (#911 release gate)');
    return;
  }
  if (!permissionsAreReadOnlyContents(audit.permissions)) {
    fail('job "security-audit" must hold exactly permissions: { contents: read }');
  }
  if (audit.env?.EXPECTED_SHA !== expectedSha) {
    fail(`job "security-audit" must audit EXPECTED_SHA: ${expectedSha}`);
  }
  if (audit.outputs?.['audited-sha'] !== AUDITED_SHA_OUTPUT) {
    fail(`job "security-audit" must output audited-sha: ${AUDITED_SHA_OUTPUT}`);
  }
  checkAuditSteps(asList(audit.steps), expectedSha, fail);
}

function checkGatedJob(jobName, job, fail) {
  if (!job) {
    fail(`gated job "${jobName}" is missing`);
    return;
  }
  if (!asList(job.needs).includes('security-audit'))
    fail(`job "${jobName}" must need "security-audit"`);
  const condition = String(job.if ?? '');
  for (const required of REQUIRED_GATE_CONDITIONS) {
    if (!condition.includes(required)) fail(`job "${jobName}" if: must require ${required}`);
  }
  if (STATUS_FUNCTION.test(condition)) {
    fail(
      `job "${jobName}" if: must not use a status function; it would let the job run after a failed, skipped or cancelled audit`,
    );
  }
}

/** Failures for one gated workflow, given its file name and source text. */
export function checkReleaseSecurityWorkflow(fileName, source) {
  const spec = RELEASE_GATED_WORKFLOWS[fileName];
  if (!spec) return [];
  const failures = [];
  const fail = (message) => failures.push({ file: fileName, message });
  let workflow;
  try {
    workflow = parse(source);
  } catch (error) {
    fail(`YAML parse error: ${error instanceof Error ? error.message : String(error)}`);
    return failures;
  }
  const jobs = workflow?.jobs ?? {};
  checkAuditJob(jobs['security-audit'], spec.expectedSha, fail);
  for (const jobName of spec.gatedJobs) checkGatedJob(jobName, jobs[jobName], fail);
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!spec.gatedJobs.includes(jobName) && hasWritePermission(job)) {
      fail(
        `job "${jobName}" holds a write permission but is not behind the #911 release security gate`,
      );
    }
  }
  return failures;
}

export function checkReleaseSecurityGates(
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
) {
  return Object.keys(RELEASE_GATED_WORKFLOWS).flatMap((fileName) => {
    const path = join(root, '.github', 'workflows', fileName);
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      return [{ file: fileName, message: 'gated workflow is missing' }];
    }
    return checkReleaseSecurityWorkflow(fileName, source);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const failures = checkReleaseSecurityGates();
  for (const failure of failures) console.error(`- [${failure.file}] ${failure.message}`);
  if (failures.length > 0) process.exit(1);
  console.log('[release-security-gate] every publishing job waits on an exact-ref audit');
}
