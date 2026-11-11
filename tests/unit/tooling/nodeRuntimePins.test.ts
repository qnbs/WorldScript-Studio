// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}

// 2026-11-11 security release of the 22.x line (#1245); raise it with the next one.
const NODE_22_SECURITY_FLOOR = [22, 23, 5];
// Two preludes keep their exact setup-node inputs and follow the runner toolcache:
// - the merge-admission prelude: workflow-policy-check.mjs (MERGE_ADMISSION_PRELUDE) allows exactly node-version '22';
// - the reviewer-governance trust workflow: a protected path of check-protected-transitions.mjs, changeable only through
//   an authorized transition in .github/governance/protected-transitions.json.
// Every other setup-node must check for the latest patch.
const FROZEN_PRELUDES: Record<string, Record<string, unknown>> = {
  'pr-changelog-reference.yml': { 'node-version': '22' },
  'reviewer-governance-trust.yml': { 'node-version-file': '.nvmrc', cache: 'pnpm' },
};

function setupNodeSteps(): Array<{ file: string; step: Step }> {
  const files = [
    ...readdirSync('.github/workflows')
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => join('.github/workflows', file)),
    ...readdirSync('.github/actions').map((dir) => join('.github/actions', dir, 'action.yml')),
  ];
  return files.flatMap((file) => {
    const doc = parse(readFileSync(file, 'utf8')) as {
      jobs?: Record<string, { steps?: Step[] }>;
      runs?: { steps?: Step[] };
    };
    const steps = [
      ...Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []),
      ...(doc.runs?.steps ?? []),
    ];
    return steps
      .filter((step) => String(step.uses ?? '').startsWith('actions/setup-node@'))
      .map((step) => ({ file, step }));
  });
}

describe('Node runtimes take the newest security patch of their major (#1245)', () => {
  it('make every setup-node except the two frozen preludes check for the latest patch', () => {
    const steps = setupNodeSteps();
    expect(steps.length).toBeGreaterThanOrEqual(5);
    for (const [workflow, inputs] of Object.entries(FROZEN_PRELUDES)) {
      const frozen = steps.filter(({ file }) => basename(file) === workflow);
      expect(
        frozen.map(({ step }) => step.with),
        workflow,
      ).toEqual([inputs]);
    }
    for (const { file, step } of steps) {
      if (basename(file) in FROZEN_PRELUDES) continue;
      expect(step.with?.['check-latest'], file).toBe(true);
    }
  });

  it('pin the Docker builder to an exact, digest-pinned Node patch on the .nvmrc major, and assert it at build time', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    const from =
      /^FROM node:(\d+)\.(\d+)\.(\d+)-alpine[\d.]*@sha256:[0-9a-f]{64} AS builder\n/m.exec(
        dockerfile,
      );
    expect(from, 'FROM node:<x.y.z>-alpine…@sha256:… AS builder').not.toBeNull();
    const version = (from ?? []).slice(1, 4).map(Number);
    expect(String(version[0])).toBe(readFileSync('.nvmrc', 'utf8').trim());
    const atLeastFloor =
      version[1] !== NODE_22_SECURITY_FLOOR[1]
        ? (version[1] ?? 0) > (NODE_22_SECURITY_FLOOR[1] ?? 0)
        : (version[2] ?? 0) >= (NODE_22_SECURITY_FLOOR[2] ?? 0);
    expect(
      atLeastFloor,
      `builder Node ${version.join('.')} below ${NODE_22_SECURITY_FLOOR.join('.')}`,
    ).toBe(true);
    // The pull resolves the digest, not the tag, so the build itself must prove the digest is the tagged patch.
    const afterFrom = dockerfile.slice((from?.index ?? 0) + (from?.[0].length ?? 0));
    const assertion =
      /^RUN test "\$\(node -p 'process\.versions\.node'\)" = "(\d+\.\d+\.\d+)"$/m.exec(afterFrom);
    expect(assertion, 'RUN test "$(node -p …)" = "<x.y.z>" after the builder FROM').not.toBeNull();
    expect(assertion?.[1]).toBe(version.join('.'));
    expect(afterFrom.slice(0, assertion?.index ?? 0)).not.toMatch(/^(FROM|RUN) /m);
  });
});
