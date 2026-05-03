#!/usr/bin/env node
/**
 * One-shot: pip install graphifyy (official PyPI name has double "y").
 * Run once per machine, then `pnpm run graphify:update`.
 * See docs/graphify.md
 */
import { spawnSync } from 'node:child_process';

const pipInstall = ['-m', 'pip', 'install', '--upgrade', 'graphifyy'];

/** @param {string} cmd @param {string[]} args */
function pip(cmd, args) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

for (const py of process.platform === 'win32'
  ? ['python', 'python3']
  : ['python3', 'python']) {
  const r = pip(py, pipInstall);
  if (r.status === 0) process.exit(0);
}

if (process.platform === 'win32') {
  const r = pip('py', ['-3', ...pipInstall]);
  if (r.status === 0) process.exit(0);
}

process.stderr.write(
  `[graphify-bootstrap] Could not install graphifyy.\n` +
    `Install Python 3.11+ from https://www.python.org/downloads/ (enable “Add to PATH”), then:\n` +
    `  python -m pip install --upgrade graphifyy\n` +
    `PyPI package name is graphifyy (two y’s), CLI command remains: graphify\n`,
);
process.exit(1);
