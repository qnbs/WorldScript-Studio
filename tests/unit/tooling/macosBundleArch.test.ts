// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
}
interface Job {
  'runs-on'?: string;
  strategy?: { matrix?: { include?: Array<{ os: string; arch?: string }> } };
  steps?: Step[];
}

const workflow = (file: string) =>
  parse(readFileSync(`.github/workflows/${file}`, 'utf8')) as { jobs: Record<string, Job> };
const VERIFY_STEP = 'Verify the macOS bundle architecture and DMG';

function verifyStep(job: Job | undefined): Step | undefined {
  return job?.steps?.find((step) => step.name === VERIFY_STEP);
}

const bundleJob = (): Job => workflow('tauri-build.yml').jobs['bundle'] ?? {};
const releaseLegs = () => bundleJob().strategy?.matrix?.include ?? [];
const stepNames = (job: Job) => (job.steps ?? []).map((step) => step.name);

// #507: a macOS bundle must be native to its declared arch, and its DMG must mount and contain that app.
describe('macOS bundles are checked for their native architecture', () => {
  it('declare the native arch of each macOS release leg', () => {
    const macos = releaseLegs().filter((leg) => leg.os.startsWith('macos'));
    expect(macos.length).toBeGreaterThanOrEqual(1);
    const expected: Record<string, string> = {
      'macos-latest': 'arm64',
      'macos-26-intel': 'x86_64',
    };
    for (const leg of macos) {
      expect(leg.arch, leg.os).toBe(expected[leg.os]);
    }
  });

  it('embed the generated notices in the Intel qualification bundle like the release build', () => {
    const build = workflow('tauri-intel-qualification.yml').jobs['qualify']?.steps?.find((step) =>
      step.name?.startsWith('Build Tauri app'),
    );
    expect(build?.run).toContain('pnpm exec tauri build --config "$RESOURCES"');
    expect(build?.run).toContain('"THIRD_PARTY_NOTICES.txt"');
  });

  it('check that arch on every macOS leg before the bundle is uploaded', () => {
    const job = bundleJob();
    const step = verifyStep(job) ?? {};
    expect(step.if).toBe("contains(matrix.os, 'macos')");
    expect(step.env?.['EXPECTED_ARCH']).toMatch(/^\$\{\{ matrix\.arch \}\}$/);
    const names = stepNames(job);
    expect(names.indexOf(VERIFY_STEP)).toBeLessThan(names.indexOf('Upload bundle directory'));
  });

  it('qualify Intel on macos-26-intel with the same check, expecting x86_64', () => {
    const qualify = workflow('tauri-intel-qualification.yml').jobs['qualify'];
    expect(qualify?.['runs-on']).toBe('macos-26-intel');
    const step = verifyStep(qualify);
    expect(step?.env?.['EXPECTED_ARCH']).toBe('x86_64');
    const release = verifyStep(bundleJob());
    expect(step?.run).toBe(release?.run);
  });

  it('keep the Intel leg out of the release matrix until the release integration lands', () => {
    expect(releaseLegs().map((leg) => leg.os)).not.toContain('macos-26-intel');
  });
});
