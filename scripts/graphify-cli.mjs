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

/** Prefer `python -m graphify` on Windows — pip puts graphify.exe in Scripts/, often not on PATH. */
const tryPythonFirst = process.platform === 'win32';

const pyLaunchers =
  process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];

if (!tryPythonFirst) {
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
}

for (const py of pyLaunchers) {
  const pyArgs = py === 'py' ? ['-3', '-m', 'graphify', ...args] : ['-m', 'graphify', ...args];
  const fallback = run(py, pyArgs);
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

if (tryPythonFirst) {
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
}

process.stderr.write(
  `[graphify-cli] Could not run Graphify. Official PyPI package: graphifyy (two y’s).\n` +
    `  pnpm run graphify:bootstrap\n` +
    `  # or: python -m pip install --upgrade graphifyy\n` +
    `On Windows, add Python Scripts to PATH (often %APPDATA%\\Python\\Python3xx\\Scripts),\n` +
    `avoid the Microsoft Store “python” stub (use python.org installer), then:\n` +
    `  py -m graphify ${args.join(' ')}\n`,
);
process.exit(1);
