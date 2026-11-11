// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  run?: string;
  'timeout-minutes'?: number;
}

const workflow = parse(readFileSync('.github/workflows/tauri-build.yml', 'utf8')) as {
  jobs: Record<string, { steps?: Step[] }>;
};
const script = readFileSync('scripts/ci/apt-install.sh', 'utf8');
const aptSteps = Object.values(workflow.jobs)
  .flatMap((job) => job.steps ?? [])
  .filter((step) => /apt-get|apt-install\.sh/.test(String(step.run ?? '')));

// 2026-11-11: an unresolvable azure.archive.ubuntu.com kept apt-get install retrying until the 45-minute job timeout (dispatch 43037609935).
describe('apt installs in the release workflow stay bounded', () => {
  it('run through the mirror-tolerant script with a short step timeout', () => {
    expect(aptSteps.length).toBeGreaterThanOrEqual(2);
    for (const step of aptSteps) {
      expect(step.run, step.name).toMatch(/^bash scripts\/ci\/apt-install\.sh \S/);
      expect(step['timeout-minutes'], step.name).toBeLessThanOrEqual(15);
    }
  });

  it('fall back from the azure mirror and bound every apt request', () => {
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).toContain('getent hosts "$MIRROR_HOST"');
    expect(script).toContain("FALLBACK='http://archive.ubuntu.com/ubuntu'");
    expect(script).toContain('Acquire::Retries=3');
    expect(script).toContain('Acquire::http::Timeout=30');
    expect(script).toContain('Acquire::https::Timeout=30');
  });
});
