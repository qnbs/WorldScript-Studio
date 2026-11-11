// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}

// 2026-11-11 security release of the 22.x line (#1245); raise it with the next one.
const NODE_22_SECURITY_FLOOR = [22, 23, 5];
// The frozen trust-boundary preludes: workflow-policy-check.mjs pins their exact setup-node inputs, so they follow the runner toolcache.
const TRUST_BOUNDARY_PRELUDES = new Set([
  'pr-changelog-reference.yml',
  'reviewer-governance-trust.yml',
]);

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
  it('make every setup-node outside the frozen trust-boundary preludes check for the latest patch', () => {
    const steps = setupNodeSteps();
    expect(steps.length).toBeGreaterThanOrEqual(5);
    const seen = new Set<string>();
    for (const { file, step } of steps) {
      const name = file.split('/').pop() ?? file;
      if (TRUST_BOUNDARY_PRELUDES.has(name)) {
        seen.add(name);
        continue;
      }
      expect(step.with?.['check-latest'], file).toBe(true);
    }
    expect(seen).toEqual(TRUST_BOUNDARY_PRELUDES);
  });

  it('pin the Docker builder to an exact, digest-pinned Node patch on the .nvmrc major', () => {
    const from =
      /^FROM node:(\d+)\.(\d+)\.(\d+)-alpine[\d.]*@sha256:[0-9a-f]{64} AS builder$/m.exec(
        readFileSync('Dockerfile', 'utf8'),
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
  });
});
