// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('ship both macOS architectures from native release legs', () => {
    const macos = releaseLegs()
      .filter((leg) => leg.os.startsWith('macos'))
      .map((leg) => [leg.os, leg.arch]);
    expect(macos).toEqual([
      ['macos-latest', 'arm64'],
      ['macos-26-intel', 'x86_64'],
    ]);
  });

  it('give the Intel updater payload its own name after the tag signature check and before upload', () => {
    const names = stepNames(bundleJob());
    const rename = names.indexOf('Name the Intel updater payload uniquely');
    expect(rename).toBeGreaterThan(
      names.indexOf('Cryptographically verify signed bundle artifacts'),
    );
    expect(rename).toBeLessThan(names.indexOf(VERIFY_STEP));
    const step = bundleJob().steps?.[rename] ?? {};
    expect(step.if).toBe("matrix.arch == 'x86_64'");
  });
});

const TAG_PUSH = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag' };
const TAG_DISPATCH = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'tag' };
const pair = (base: string) => [`${base}.app.tar.gz`, `${base}.app.tar.gz.sig`];

// Runs the shipped rename step in a scratch bundle directory and returns its exit status and the files left.
function runRename(files: string[], env: Record<string, string>) {
  const run = bundleJob().steps?.find(
    (s) => s.name === 'Name the Intel updater payload uniquely',
  )?.run;
  const root = mkdtempSync(join(tmpdir(), 'intel-rename-'));
  const dir = join(root, 'src-tauri/target/release/bundle/macos');
  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), 'payload');
  try {
    const result = spawnSync('bash', ['-c', String(run)], {
      cwd: root,
      env: { PATH: process.env['PATH'] ?? '', ...env },
      encoding: 'utf8',
    });
    return { status: result.status, files: readdirSync(dir).sort() };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the Intel updater payload rename (#507)', () => {
  it.each(['WorldScript Studio', 'WorldScript.Studio'])(
    'renames the %s payload and its signature',
    (base) => {
      expect(runRename(pair(base), TAG_PUSH)).toEqual({ status: 0, files: pair(`${base}_x64`) });
    },
  );

  it('refuses to pick between a spaced and a dotted payload', () => {
    const files = [...pair('WorldScript Studio'), ...pair('WorldScript.Studio')].sort();
    expect(runRename(files, TAG_PUSH)).toEqual({ status: 1, files });
  });

  it('fails when the payload has no signature sidecar', () => {
    expect(runRename(['WorldScript Studio.app.tar.gz'], TAG_PUSH).status).not.toBe(0);
  });

  it('fails a tag push without a payload but lets a dispatch on a tag ref pass', () => {
    expect(runRename([], TAG_PUSH).status).toBe(1);
    expect(runRename([], TAG_DISPATCH)).toEqual({ status: 0, files: [] });
  });
});
