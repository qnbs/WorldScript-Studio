#!/usr/bin/env node
/**
 * Install @colbymchenry/codegraph at the exact version pinned in config/graph-tools-versions.json.
 * CodeGraph is optional local developer tooling — this never touches package.json dependencies.
 * Never falls through to an unpinned "latest" install. See docs/codegraph.md
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodegraphCommand } from './codegraph-report.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'config', 'graph-tools-versions.json'), 'utf-8'));
const version = policy.codegraph.testedVersion;
const pinnedSpec = `@colbymchenry/codegraph@${version}`;
const codegraphCommand = resolveCodegraphCommand();

const install = spawnSync('npm', ['install', '-g', pinnedSpec], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (install.status !== 0) {
  process.stderr.write(
    `[codegraph-bootstrap] Could not install ${pinnedSpec} via npm.\n` +
      `Install manually: npm install -g ${pinnedSpec}\n`,
  );
  process.exit(install.status ?? 1);
}

// QNBS-v3: keep optional CodeGraph outside app dependencies while verifying the exact shared policy version.
const verify = spawnSync(codegraphCommand, ['--version'], {
  encoding: 'utf-8',
  shell: process.platform === 'win32',
  env: process.env,
});
const installedVersion = (verify.stdout ?? '').trim();
if (verify.status !== 0 || !installedVersion.includes(version)) {
  process.stderr.write(
    `[codegraph-bootstrap] Installed but version verification failed. ` +
      `Expected ${version}, got: ${installedVersion || '(no output)'}\n`,
  );
  process.exit(1);
}

console.log(`[codegraph-bootstrap] Installed ${pinnedSpec} (verified: ${installedVersion}).`);
