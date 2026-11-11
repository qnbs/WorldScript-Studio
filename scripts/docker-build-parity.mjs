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
// Deny by default: these inputs only choose where the result goes or how it is cached and attested; every other input must be equal in all three builds.
export const DESTINATION_INPUTS = Object.freeze([
  'push',
  'load',
  'tags',
  'labels',
  'cache-from',
  'cache-to',
  'provenance',
  'sbom',
]);
// The exact command text of the extraction and the bundle check in both jobs. Any variant (`|| true`, `set +e`, another path or tool) fails, so the check cannot be weakened without changing this module and its test.
export const CANONICAL_RUN = Object.freeze({
  extract: [
    'set -euo pipefail',
    'test -n "$IMAGE_ID"',
    'container="$(docker create "$IMAGE_ID")"',
    'docker cp "$container:/usr/share/nginx/html" "$RUNNER_TEMP/image-html"',
    'docker rm "$container" > /dev/null',
    '',
  ].join('\n'),
  bundleCheck: [
    'set -euo pipefail',
    'node scripts/check-image-bundle.mjs "$RUNNER_TEMP/image-html" | tee -a "$GITHUB_STEP_SUMMARY"',
    '',
  ].join('\n'),
});
const IMAGE_ID_ENV = /^\$\{\{ steps\.image-check-build\.outputs\.imageid \}\}$/;
const CONTEXT_CHECK_RUN = 'node scripts/check-dockerfile-context.mjs';
// Run steps allowed before the bundle check; anything else could rewrite PATH or the environment through GITHUB_PATH or GITHUB_ENV.
const EARLIER_RUNS = [CANONICAL_RUN.extract, CONTEXT_CHECK_RUN];

const asDocument = (source) => (typeof source === 'string' ? parse(source) : source) ?? {};
const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const usesOf = (step) => String(step?.uses ?? '');
const runOf = (step) => String(step?.run ?? '');
// The build action reads its inputs as strings, so `push: "true"` publishes exactly like `push: true`.
const flag = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';
const isCheckBuild = (step) => flag(step?.with?.load) && !flag(step?.with?.push);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const buildInputs = (step) =>
  Object.entries(step?.with ?? {})
    .filter(([key]) => !DESTINATION_INPUTS.includes(key))
    .sort(([a], [b]) => a.localeCompare(b));

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
    pushBuild: builds.find((index) => flag(steps[index]?.with?.push)) ?? -1,
    extract: steps.findIndex((step) => runOf(step).includes(EXTRACT)),
    bundleCheck: steps.findIndex((step) => runOf(step).includes(BUNDLE_CHECK)),
    pin: (prefix) => steps.find((step) => usesOf(step).startsWith(prefix))?.uses ?? null,
  };
}

// Directly adjacent steps: nothing may run between the check build, the extraction, the check and the push, so the push rebuilds exactly the context that was checked.
const consecutive = (indexes) =>
  indexes.every((value, i) => value >= 0 && (i === 0 || value === indexes[i - 1] + 1));

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
      consecutive([publish.checkBuild, publish.extract, publish.bundleCheck, publish.pushBuild]),
    `${PUBLISH_JOB} must build, extract, check and push the image as consecutive steps`,
  ],
  [
    (_publish, check) => consecutive([check.checkBuild, check.extract, check.bundleCheck]),
    `${CHECK_JOB} must build, extract and check the image as consecutive steps`,
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
  if (!builds.every((step) => sameJson(buildInputs(step), buildInputs(builds[0])))) {
    errors.push(
      `build inputs other than ${DESTINATION_INPUTS.join(', ')} differ between the image builds`,
    );
  }
  for (const prefix of [CHECKOUT, SETUP_BUILDX]) {
    if (publish.pin(prefix) === null || publish.pin(prefix) !== check.pin(prefix)) {
      errors.push(`${prefix.slice(0, -1)} must be pinned to the same commit in both jobs`);
    }
  }
  return errors;
}

function sameCheckBuildId(publish, check) {
  return sameJson(publish.steps[publish.checkBuild]?.id, check.steps[check.checkBuild]?.id)
    ? []
    : ['the check builds must have the same id in both jobs'];
}

const onlyKeys = (step, allowed) => Object.keys(step ?? {}).every((key) => allowed.includes(key));
const imageIdEnv = (step) =>
  sameJson(Object.keys(step?.env ?? {}), ['IMAGE_ID']) &&
  IMAGE_ID_ENV.test(String(step?.env?.IMAGE_ID));

// Canonical step definitions: no extra keys (an env override, shell, working-directory, if or continue-on-error) and the exact command text.
const CANONICAL_CHECKS = {
  extract: (step) => [
    onlyKeys(step, ['name', 'env', 'run']),
    imageIdEnv(step),
    runOf(step) === CANONICAL_RUN.extract,
  ],
  bundleCheck: (step) => [
    onlyKeys(step, ['name', 'run']),
    runOf(step) === CANONICAL_RUN.bundleCheck,
  ],
};

function canonicalErrors(job, name) {
  return Object.entries(CANONICAL_CHECKS)
    .filter(([role, checks]) => !checks(job.steps[job[role]]).every(Boolean))
    .map(([role]) => `${name} must contain the canonical ${role} step unchanged`);
}

function scopeErrors(document, job, name) {
  const scoped = [document, job].some(
    (scope) => scope?.env !== undefined || scope?.defaults !== undefined,
  );
  return scoped ? [`${name} must not set env or defaults at job or workflow level`] : [];
}

function earlierRunErrors(job, name) {
  const foreign = job.steps
    .slice(0, job.bundleCheck)
    .filter((step) => step?.run !== undefined && !EARLIER_RUNS.includes(String(step.run)));
  return foreign.length > 0 ? [`${name} must not run other commands before the bundle check`] : [];
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

// Exact triggers: the build check runs on every pull request, every push to main and on dispatch; the publish workflow runs on v* tags and dispatch. Any added filter or removed event fails.
export const CANONICAL_TRIGGERS = Object.freeze({
  publish: { push: { tags: ['v*'] }, workflow_dispatch: null },
  check: { pull_request: null, push: { branches: ['main'] }, workflow_dispatch: null },
});

function triggerErrors(publishDocument, checkDocument) {
  return [
    ['docker.yml', publishDocument.on, CANONICAL_TRIGGERS.publish],
    ['docker-build-check.yml', checkDocument.on, CANONICAL_TRIGGERS.check],
  ]
    .filter(([, actual, expected]) => !sameJson(actual, expected))
    .map(([file, , expected]) => `${file} triggers must be exactly ${JSON.stringify(expected)}`);
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
  const always = [
    ...triggerErrors(publishDocument, checkDocument),
    ...readOnlyErrors(checkDocument, checkJob),
  ];
  const shape = shapeErrors(publish, check);
  if (shape.length > 0) return [...shape, ...always];
  return [
    ...parityErrors(publish, check),
    ...sameCheckBuildId(publish, check),
    ...canonicalErrors(publish, PUBLISH_JOB),
    ...canonicalErrors(check, CHECK_JOB),
    ...scopeErrors(publishDocument, publishJob, PUBLISH_JOB),
    ...scopeErrors(checkDocument, checkJob, CHECK_JOB),
    ...earlierRunErrors(publish, PUBLISH_JOB),
    ...earlierRunErrors(check, CHECK_JOB),
    ...unconditionalErrors(publish, PUBLISH_JOB),
    ...unconditionalErrors(check, CHECK_JOB),
    ...always,
  ];
}
