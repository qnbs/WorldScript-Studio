// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { dockerBuildParity } from '../../../scripts/docker-build-parity.mjs';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: { platforms?: string; push?: boolean; [key: string]: unknown };
  'continue-on-error'?: boolean;
}
interface Job {
  name?: string;
  permissions?: unknown;
  steps: Step[];
}
interface Workflow {
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
    'essential build inputs differ',
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
    'before the push step',
  ],
  [
    'the publish job drops the bundle check',
    (d) => {
      const steps = publishSteps(d);
      steps.splice(steps.indexOf(named(steps, BUNDLE_CHECK)), 1);
    },
    'before the push step',
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
    'the same run in both jobs',
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
