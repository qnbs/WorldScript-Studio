#!/usr/bin/env node
/**
 * Invokes the Graphify CLI via `graphify` on PATH, or falls back to `python -m graphify`
 * when pip installed scripts but the Scripts directory is not on PATH (typical on Windows).
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

/** @param {string} command @param {string[]} commandArgs */
function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

const primary = run('graphify', args);
if (primary.status === 0) {
  process.exit(0);
}

const notFound =
  primary.error?.code === 'ENOENT' ||
  primary.status === 9009 ||
  primary.status === 127;

if (!notFound && primary.status != null) {
  process.exit(primary.status);
}

const pyLaunchers =
  process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];

for (const py of pyLaunchers) {
  const fallback = run(py, ['-m', 'graphify', ...args]);
  if (fallback.status === 0) {
    process.exit(0);
  }
  if (
    fallback.error?.code !== 'ENOENT' &&
    fallback.status !== 9009 &&
    fallback.status !== 127 &&
    fallback.status != null
  ) {
    process.exit(fallback.status);
  }
}

process.stderr.write(
  `[graphify-cli] Could not run Graphify. Install the official PyPI package:\n` +
    `  pip install graphifyy\n` +
    `On Windows, add Python Scripts to PATH (often %APPDATA%\\Python\\Python3xx\\Scripts)\n` +
    `or run: py -m graphify ${args.join(' ')}\n`,
);
process.exit(primary.status ?? 1);
