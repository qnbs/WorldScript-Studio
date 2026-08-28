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
  { tool: 'uv', args: ['tool', 'install', pinnedSpec] },
  { tool: 'pipx', args: ['install', pinnedSpec] },
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
  if (result.status === 0) {
    console.log(`[graphify-bootstrap] Installed ${pinnedSpec} via ${tool}.`);
    process.exit(0);
  }
}

process.stderr.write(
  `[graphify-bootstrap] Could not install ${pinnedSpec} via uv, pipx, or pip.\n` +
    `Install one of those tools, or install manually:\n` +
    `  uv tool install ${pinnedSpec}\n` +
    `  pipx install ${pinnedSpec}\n` +
    `  python -m pip install ${pinnedSpec}\n` +
    `PyPI package name is graphifyy (two y's), CLI command remains: graphify\n`,
);
process.exit(1);
