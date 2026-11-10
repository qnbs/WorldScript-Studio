// QNBS-v3 (#1223): the no-push build check must build what the publish job builds, and the publish job must check the image before it pushes. Any drift between the two jobs is a failure.
import { parse } from 'yaml';
import { BUILD_CHECK_JOB } from './release-container-precheck.mjs';

export const PUBLISH_JOB = 'build-push';
export const CHECK_JOB = 'build-check';
export const BUNDLE_CHECK = 'scripts/check-image-bundle.mjs';

const BUILD_PUSH = 'docker/build-push-action@';
const SETUP_BUILDX = 'docker/setup-buildx-action@';
const CHECKOUT = 'actions/checkout@';
const LOGIN = 'docker/login-action@';
const EXTRACT = 'docker cp';
// Inputs that change what is built. Tags, labels, cache, push and load only change where the result goes.
const ESSENTIAL_INPUTS = [
  'context',
  'file',
  'platforms',
  'target',
  'build-args',
  'build-contexts',
  'secrets',
  'secret-files',
  'ssh',
  'network',
  'no-cache',
  'pull',
];

const asDocument = (source) => (typeof source === 'string' ? parse(source) : source) ?? {};
const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const usesOf = (step) => String(step?.uses ?? '');
const runOf = (step) => String(step?.run ?? '');
const isCheckBuild = (step) => step?.with?.load === true && step?.with?.push !== true;
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const essentialInputs = (step) => ESSENTIAL_INPUTS.map((key) => step?.with?.[key] ?? null);

/** The build, extract and bundle-check steps of one job, by index (-1 when absent). */
function locate(job) {
  const steps = stepsOf(job);
  const builds = steps.flatMap((step, index) =>
    usesOf(step).startsWith(BUILD_PUSH) ? [index] : [],
  );
  return {
    steps,
    builds,
    checkBuild: builds.find((index) => isCheckBuild(steps[index])) ?? -1,
    pushBuild: builds.find((index) => steps[index]?.with?.push === true) ?? -1,
    extract: steps.findIndex((step) => runOf(step).includes(EXTRACT)),
    bundleCheck: steps.findIndex((step) => runOf(step).includes(BUNDLE_CHECK)),
    pin: (prefix) => steps.find((step) => usesOf(step).startsWith(prefix))?.uses ?? null,
  };
}

const ascending = (indexes) =>
  indexes.every((value, i) => value >= 0 && (i === 0 || value > indexes[i - 1]));

const hasBuilds = (job, count, roles) =>
  job.builds.length === count && roles.every((role) => job[role] >= 0);

/** [passes(publish, check), message] for the step layout of both jobs. */
const SHAPE_RULES = [
  [
    (publish) => hasBuilds(publish, 2, ['checkBuild', 'pushBuild']),
    `${PUBLISH_JOB} must build once with load: true for the check and once with push: true`,
  ],
  [
    (_publish, check) => hasBuilds(check, 1, ['checkBuild']),
    `${CHECK_JOB} must build exactly once with load: true and without push`,
  ],
  [
    (publish) =>
      ascending([publish.checkBuild, publish.extract, publish.bundleCheck, publish.pushBuild]),
    `${PUBLISH_JOB} must build, extract and check the image before the push step`,
  ],
  [
    (_publish, check) => ascending([check.checkBuild, check.extract, check.bundleCheck]),
    `${CHECK_JOB} must build, extract and check the image in that order`,
  ],
];

function shapeErrors(publish, check) {
  return SHAPE_RULES.filter(([passes]) => !passes(publish, check)).map(([, message]) => message);
}

function parityErrors(publish, check) {
  const errors = [];
  const builds = [
    publish.steps[publish.checkBuild],
    publish.steps[publish.pushBuild],
    check.steps[check.checkBuild],
  ];
  if (new Set(builds.map(usesOf)).size !== 1)
    errors.push('every image build must use the same pinned build-push action');
  if (!builds.every((step) => sameJson(essentialInputs(step), essentialInputs(builds[0])))) {
    errors.push(`essential build inputs differ (${ESSENTIAL_INPUTS.join(', ')})`);
  }
  for (const prefix of [CHECKOUT, SETUP_BUILDX]) {
    if (publish.pin(prefix) === null || publish.pin(prefix) !== check.pin(prefix)) {
      errors.push(`${prefix.slice(0, -1)} must be pinned to the same commit in both jobs`);
    }
  }
  return errors;
}

function sameCheckSteps(publish, check) {
  const pairs = [
    [publish.checkBuild, check.checkBuild, 'id'],
    [publish.extract, check.extract, 'run'],
    [publish.extract, check.extract, 'env'],
    [publish.bundleCheck, check.bundleCheck, 'run'],
  ];
  return pairs
    .filter(([a, b, key]) => !sameJson(publish.steps[a]?.[key], check.steps[b]?.[key]))
    .map(([, , key]) => `the image check steps must have the same ${key} in both jobs`);
}

function unconditionalErrors(job, name) {
  return [job.checkBuild, job.extract, job.bundleCheck]
    .map((index) => job.steps[index])
    .filter((step) => step && (step.if !== undefined || step['continue-on-error'] !== undefined))
    .map(
      (step) => `${name} step "${step.name ?? step.uses}" must not set if: or continue-on-error`,
    );
}

function readOnlyErrors(document, job) {
  const errors = [];
  const readOnly = { contents: 'read' };
  if (!sameJson(document.permissions, readOnly) || !sameJson(job?.permissions, readOnly)) {
    errors.push(`the build check must hold exactly permissions: { contents: read }`);
  }
  if (stepsOf(job).some((step) => usesOf(step).startsWith(LOGIN))) {
    errors.push('the build check must not log in to a registry');
  }
  if (job?.name !== BUILD_CHECK_JOB)
    errors.push(`the build check job must be named "${BUILD_CHECK_JOB}"`);
  return errors;
}

/** @returns {string[]} every parity violation between docker.yml and docker-build-check.yml */
export function dockerBuildParity(publishSource, checkSource) {
  const publishDocument = asDocument(publishSource);
  const checkDocument = asDocument(checkSource);
  const publishJob = publishDocument.jobs?.[PUBLISH_JOB];
  const checkJob = checkDocument.jobs?.[CHECK_JOB];
  if (!publishJob || !checkJob) return [`missing job ${publishJob ? CHECK_JOB : PUBLISH_JOB}`];
  const publish = locate(publishJob);
  const check = locate(checkJob);
  const shape = shapeErrors(publish, check);
  if (shape.length > 0) return [...shape, ...readOnlyErrors(checkDocument, checkJob)];
  return [
    ...parityErrors(publish, check),
    ...sameCheckSteps(publish, check),
    ...unconditionalErrors(publish, PUBLISH_JOB),
    ...unconditionalErrors(check, CHECK_JOB),
    ...readOnlyErrors(checkDocument, checkJob),
  ];
}
