// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  run?: string;
}

const STEP = 'Cryptographically verify signed bundle artifacts';
const workflow = parse(readFileSync('.github/workflows/tauri-build.yml', 'utf8')) as {
  jobs: Record<string, { steps?: Step[] }>;
};
const run = String(workflow.jobs['bundle']?.steps?.find((step) => step.name === STEP)?.run);

const DEB = 'WorldScript Studio_9.9.9_amd64.deb';
const RPM = 'WorldScript Studio-9.9.9-1.x86_64.rpm';
const APPIMAGE = 'WorldScript Studio_9.9.9_amd64.AppImage';
const LINUX = [`deb/${DEB}`, `rpm/${RPM}`, `appimage/${APPIMAGE}`];
const withSigs = (files: string[]) => files.flatMap((file) => [file, `${file}.sig`]);

// Runs the shipped step for tag v9.9.9 on a fake Linux bundle directory; `cargo` is a stand-in that logs its call.
function runStep(files: Record<string, string>, cargoExit = 0) {
  const root = mkdtempSync(join(tmpdir(), 'bundle-verify-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'cargo'),
    `#!/bin/sh\nfor last; do :; done\necho "$last" >> "${root}/cargo.log"\nexit ${cargoExit}\n`,
  );
  chmodSync(join(bin, 'cargo'), 0o755);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, 'src-tauri/target/release/bundle', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  try {
    const result = spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-c', run], {
      cwd: root,
      env: { PATH: `${bin}:/usr/bin:/bin`, RUNNER_OS: 'Linux', GITHUB_REF_NAME: 'v9.9.9' },
      encoding: 'utf8',
    });
    let cargoCalls: string[] = [];
    try {
      cargoCalls = readFileSync(join(root, 'cargo.log'), 'utf8').trim().split('\n');
    } catch {}
    return { status: result.status, stdout: result.stdout, cargoCalls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const filled = (files: string[]) => Object.fromEntries(files.map((file) => [file, 'x']));

// The v1.29.6 tag run's first Windows attempt failed here without any message; every failure must now say why.
describe('the bundle signature step reports every failure', () => {
  it('verifies each Linux package with its sidecar', () => {
    const result = runStep(filled(withSigs(LINUX)));
    expect(result.status, result.stdout).toBe(0);
    expect(result.cargoCalls.map((sig) => sig.split('/').pop())).toEqual([
      `${DEB}.sig`,
      `${RPM}.sig`,
      `${APPIMAGE}.sig`,
    ]);
  });

  it('names a missing package and lists the bundle files', () => {
    const result = runStep(filled(withSigs([`deb/${DEB}`, `appimage/${APPIMAGE}`])));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::expected exactly one bundle asset named ${RPM}, found 0`,
    );
    expect(result.stdout).toContain(`  bundle file: src-tauri/target/release/bundle/deb/${DEB}`);
  });

  it('refuses a spaced and a dotted copy of the same package', () => {
    const dotted = `deb/${DEB.replaceAll(' ', '.')}`;
    const result = runStep(filled(withSigs([...LINUX, dotted])));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::expected exactly one bundle asset named ${DEB}, found 2`,
    );
  });

  it('names an empty package and a missing sidecar', () => {
    const empty = runStep({ ...filled(withSigs(LINUX)), [`deb/${DEB}`]: '' });
    expect(empty.status).toBe(1);
    expect(empty.stdout).toContain(`::error::bundle asset is empty: ${DEB}`);
    const noSig = filled(withSigs(LINUX));
    delete noSig[`rpm/${RPM}.sig`];
    const missing = runStep(noSig);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain(`::error::missing signature sidecar for ${RPM}`);
  });

  it('names the line and command when the verifier fails', () => {
    const result = runStep(filled(withSigs(LINUX)), 1);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(
      /::error::bundle signature check failed at line \d+: cargo run --locked/,
    );
  });
});
