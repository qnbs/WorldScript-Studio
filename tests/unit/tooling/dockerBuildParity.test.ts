// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { dockerBuildParity } from '../../../scripts/docker-build-parity.mjs';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: { platforms?: string; push?: boolean | string; [key: string]: unknown };
  'continue-on-error'?: boolean;
}
interface Job {
  name?: string;
  permissions?: unknown;
  steps: Step[];
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: unknown;
  jobs: Record<string, Job | undefined>;
}
interface Documents {
  publish: Workflow;
  check: Workflow;
}

const publishSource = readFileSync('.github/workflows/docker.yml', 'utf8');
const checkSource = readFileSync('.github/workflows/docker-build-check.yml', 'utf8');
const documents = (): Documents => ({
  publish: parse(publishSource) as Workflow,
  check: parse(checkSource) as Workflow,
});

const jobOf = (workflow: Workflow, name: string): Job => {
  const job = workflow.jobs[name];
  if (!job) throw new Error(`missing job ${name}`);
  return job;
};
const publishSteps = (d: Documents) => jobOf(d.publish, 'build-push').steps;
const checkSteps = (d: Documents) => jobOf(d.check, 'build-check').steps;
const named = (steps: Step[], name: string): Step => {
  const step = steps.find((entry) => entry.name === name);
  if (!step) throw new Error(`missing step ${name}`);
  return step;
};
const inputs = (step: Step) => {
  step.with ??= {};
  return step.with;
};

const CHECK_BUILD = 'Build the image without pushing';
const BUNDLE_CHECK = 'Check the DOMPurify build inside the image';

type Case = [string, (d: Documents) => void, string];

const drift: Case[] = [
  [
    'the check builds another platform',
    (d) => {
      inputs(named(checkSteps(d), CHECK_BUILD)).platforms = 'linux/arm64';
    },
    'differ between the image builds',
  ],
  // #1225 review: deny by default, so an input the module does not list (here shm-size) still counts.
  [
    'the check sets a build input the other builds do not',
    (d) => {
      inputs(named(checkSteps(d), CHECK_BUILD))['shm-size'] = '2g';
    },
    'differ between the image builds',
  ],
  // #1225 review: the action reads inputs as strings, so a quoted "true" pushes.
  [
    'the publish check build pushes through a quoted push input',
    (d) => {
      inputs(named(publishSteps(d), 'Build the image for the pre-push check')).push = 'true';
    },
    'must build once with load: true for the check and once with push: true',
  ],
  // #1225 review: mentioning the command is not running it.
  [
    'both jobs only echo the bundle check',
    (d) => {
      for (const steps of [publishSteps(d), checkSteps(d)]) {
        named(steps, BUNDLE_CHECK).run = 'set -euo pipefail\necho scripts/check-image-bundle.mjs\n';
      }
    },
    'must contain the canonical bundleCheck step unchanged',
  ],
  [
    'both jobs run the bundle check without set -euo pipefail',
    (d) => {
      for (const steps of [publishSteps(d), checkSteps(d)]) {
        const step = named(steps, BUNDLE_CHECK);
        step.run = (step.run ?? '').replace('set -euo pipefail\n', '');
      }
    },
    'must contain the canonical bundleCheck step unchanged',
  ],
  [
    'both jobs only echo the extraction',
    (d) => {
      for (const steps of [publishSteps(d), checkSteps(d)]) {
        named(steps, 'Extract the web bundle from the built image').run =
          'set -euo pipefail\necho docker cp skipped\n';
      }
    },
    'must contain the canonical extract step unchanged',
  ],
  [
    'the check uses another build-push pin',
    (d) => {
      named(checkSteps(d), CHECK_BUILD).uses = `docker/build-push-action@${'f'.repeat(40)}`;
    },
    'the same pinned build-push action',
  ],
  [
    'the check pushes',
    (d) => {
      inputs(named(checkSteps(d), CHECK_BUILD)).push = true;
    },
    'build-check must build exactly once with load: true',
  ],
  [
    'the publish job pushes before the check',
    (d) => {
      const steps = publishSteps(d);
      const [push] = steps.splice(-1, 1);
      if (!push) throw new Error('missing push step');
      steps.splice(
        steps.findIndex((step) => step.name === 'Build the image for the pre-push check'),
        0,
        push,
      );
    },
    'must build, extract, check and push the image as consecutive steps',
  ],
  // #1225 review: the triggers are part of the promise, so removing or filtering an event fails.
  [
    'the build check drops its pull_request trigger',
    (d) => {
      d.check.on = { push: { branches: ['main'] }, workflow_dispatch: null };
    },
    'docker-build-check.yml triggers must be exactly',
  ],
  [
    'the build check filters pull requests by path',
    (d) => {
      d.check.on = { ...d.check.on, pull_request: { paths: ['Dockerfile'] } };
    },
    'docker-build-check.yml triggers must be exactly',
  ],
  [
    'the publish workflow drops its tag trigger',
    (d) => {
      d.publish.on = { workflow_dispatch: null };
    },
    'docker.yml triggers must be exactly',
  ],
  // #1225 review: a step between the check and the push could change the context the push rebuilds.
  [
    'the publish job runs a step between the check and the push',
    (d) => {
      const steps = publishSteps(d);
      steps.splice(steps.indexOf(named(steps, BUNDLE_CHECK)) + 1, 0, {
        name: 'Touch the build context',
        run: 'echo changed >> index.html',
      });
    },
    'must build, extract, check and push the image as consecutive steps',
  ],
  [
    'the publish job drops the bundle check',
    (d) => {
      const steps = publishSteps(d);
      steps.splice(steps.indexOf(named(steps, BUNDLE_CHECK)), 1);
    },
    'must build, extract, check and push the image as consecutive steps',
  ],
  [
    'the publish check may fail without stopping the push',
    (d) => {
      named(publishSteps(d), BUNDLE_CHECK)['continue-on-error'] = true;
    },
    'must not set if: or continue-on-error',
  ],
  [
    'the extraction differs between the jobs',
    (d) => {
      const step = named(checkSteps(d), 'Extract the web bundle from the built image');
      step.run = `${step.run ?? ''}\ntrue`;
    },
    'build-check must contain the canonical extract step unchanged',
  ],
  // #1225 review: canonical steps close the class of weakened checks, not single variants.
  [
    'the publish bundle check swallows a failure with || true',
    (d) => {
      const step = named(publishSteps(d), BUNDLE_CHECK);
      step.run = (step.run ?? '').replace(
        '"$GITHUB_STEP_SUMMARY"\n',
        '"$GITHUB_STEP_SUMMARY" || true\n',
      );
    },
    'build-push must contain the canonical bundleCheck step unchanged',
  ],
  [
    'the publish bundle check overrides PATH',
    (d) => {
      Object.assign(named(publishSteps(d), BUNDLE_CHECK), { env: { PATH: '/tmp/fake:/usr/bin' } });
    },
    'build-push must contain the canonical bundleCheck step unchanged',
  ],
  [
    'the publish job sets a job-level environment',
    (d) => {
      Object.assign(jobOf(d.publish, 'build-push'), { env: { PATH: '/tmp/fake:/usr/bin' } });
    },
    'build-push must not set env or defaults at job or workflow level',
  ],
  [
    'the publish job writes GITHUB_PATH before the check',
    (d) => {
      const steps = publishSteps(d);
      steps.splice(steps.indexOf(named(steps, 'Build the image for the pre-push check')), 0, {
        name: 'Prepend a directory',
        run: 'echo /tmp/fake >> "$GITHUB_PATH"',
      });
    },
    'build-push must not run other commands before the bundle check',
  ],
  [
    'the check logs in to a registry',
    (d) => {
      checkSteps(d).unshift({ uses: `docker/login-action@${'e'.repeat(40)}` });
    },
    'must not log in',
  ],
  [
    'the check can write packages',
    (d) => {
      jobOf(d.check, 'build-check').permissions = { contents: 'read', packages: 'write' };
    },
    'exactly permissions: { contents: read }',
  ],
];

describe('container build parity between docker.yml and docker-build-check.yml (#1223)', () => {
  it('keeps the repository workflows in parity', () => {
    expect(dockerBuildParity(publishSource, checkSource)).toEqual([]);
  });

  it.each(drift)('fails when %s', (_name, mutate, error) => {
    const d = documents();
    mutate(d);

    expect(dockerBuildParity(d.publish, d.check).join('\n')).toContain(error);
  });
});
