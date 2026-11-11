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

// #507: a macOS bundle must be native to its declared arch, and its DMG must mount and contain that app.
describe('macOS bundles are checked for their native architecture', () => {
  it('declare an arch for every macOS release leg and check it before upload', () => {
    const bundle = workflow('tauri-build.yml').jobs['bundle'];
    const legs = bundle?.strategy?.matrix?.include ?? [];
    const macos = legs.filter((leg) => leg.os.startsWith('macos'));
    expect(macos.length).toBeGreaterThanOrEqual(1);
    for (const leg of macos) {
      expect(['arm64', 'x86_64'], leg.os).toContain(leg.arch);
    }
    const step = verifyStep(bundle);
    expect(step?.if).toBe("contains(matrix.os, 'macos')");
    expect(step?.env?.['EXPECTED_ARCH']).toMatch(/^\$\{\{ matrix\.arch \}\}$/);
    const names = (bundle?.steps ?? []).map((s) => s.name);
    expect(names.indexOf(VERIFY_STEP)).toBeLessThan(names.indexOf('Upload bundle directory'));
  });

  it('qualify Intel on macos-26-intel with the same check, expecting x86_64', () => {
    const qualify = workflow('tauri-intel-qualification.yml').jobs['qualify'];
    expect(qualify?.['runs-on']).toBe('macos-26-intel');
    const step = verifyStep(qualify);
    expect(step?.env?.['EXPECTED_ARCH']).toBe('x86_64');
    const release = verifyStep(workflow('tauri-build.yml').jobs['bundle']);
    expect(step?.run).toBe(release?.run);
  });

  it('keep the Intel leg out of the release matrix until the release integration lands', () => {
    const legs = workflow('tauri-build.yml').jobs['bundle']?.strategy?.matrix?.include ?? [];
    expect(legs.map((leg) => leg.os)).not.toContain('macos-26-intel');
  });
});
