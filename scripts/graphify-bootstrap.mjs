#!/usr/bin/env node
/**
 * Install graphifyy at the exact version pinned in config/graph-tools-versions.json.
 * Tries uv, then pipx, then pip (in that priority order) — whichever is available on this
 * machine — always the pinned version. Never falls through to an unpinned "latest" install;
 * fails loudly instead so version drift is a visible decision, not a silent side effect.
 * Run once per machine, then `pnpm run graphify:update`. See docs/graphify.md
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesExactVersion } from './graphSourceFingerprint.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'config', 'graph-tools-versions.json'), 'utf-8'));
const version = policy.graphifyy.testedVersion;
const pinnedSpec = `graphifyy==${version}`;

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

const attempts = [
  { tool: 'uv', args: ['tool', 'install', '--force', pinnedSpec] },
  { tool: 'pipx', args: ['install', '--force', pinnedSpec] },
  ...(process.platform === 'win32'
    ? [
        { tool: 'python', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'python3', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'py', args: ['-3', '-m', 'pip', 'install', pinnedSpec] },
      ]
    : [
        { tool: 'python3', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'python', args: ['-m', 'pip', 'install', pinnedSpec] },
      ]),
];

for (const { tool, args } of attempts) {
  const result = run(tool, args);
  if (result.error?.code && result.error.code !== 'ENOENT') {
    process.stderr.write(`[graphify-bootstrap] ${tool} failed: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0 && !result.error) {
    process.stderr.write(
      `[graphify-bootstrap] ${tool} could not install ${pinnedSpec}; refusing an unintended fallback.\n`,
    );
    process.exit(result.status ?? 1);
  }
  if (result.status === 0) {
    // QNBS-v3: verify the supported fallback launcher resolves the pinned implementation before claiming installation success.
    const verify = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'graphify-cli.mjs'), '--version'],
      { encoding: 'utf-8', env: process.env },
    );
    const output = `${verify.stdout ?? ''}\n${verify.stderr ?? ''}`;
    if (verify.status === 0 && matchesExactVersion(output, version)) {
      console.log(`[graphify-bootstrap] Installed ${pinnedSpec} via ${tool} (verified).`);
      process.exit(0);
    }
    process.stderr.write(
      `[graphify-bootstrap] ${tool} installed ${pinnedSpec}, but the supported launcher did not resolve version ${version}.\n`,
    );
    process.exit(1);
  }
}

process.stderr.write(
  `[graphify-bootstrap] Could not install ${pinnedSpec} via uv, pipx, or pip.\n` +
    `Install one of those tools, or install manually:\n` +
    `  uv tool install --force ${pinnedSpec}\n` +
    `  pipx install --force ${pinnedSpec}\n` +
    `  python -m pip install ${pinnedSpec}\n` +
    `PyPI package name is graphifyy (two y's), CLI command remains: graphify\n`,
);
process.exit(1);
