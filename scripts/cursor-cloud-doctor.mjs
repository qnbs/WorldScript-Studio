#!/usr/bin/env node
/**
 * Non-secret diagnostics for Cursor Cloud Agent sessions.
 * Does not replace signing:doctor, ci:prepush, or GitHub merge authority.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROBE_TIMEOUT_MS = 15_000;
const jsonMode = process.argv.includes('--json');
const cwd = process.cwd();

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.()?.trim();
    return stderr ? `error: ${stderr.split('\n')[0]}` : 'unavailable';
  }
}

function isOfflineDoctorMode() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: test-only offline probe skip for unit tests
  return process.env.CURSOR_CLOUD_DOCTOR_OFFLINE === '1';
}

function readPackageJson(root = cwd) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function buildSummary(input) {
  const pkg = input.pkg ?? {};
  const gitTransport =
    input.gitTransportProbe === 'offline-skipped'
      ? 'offline-skipped'
      : input.gitTransportProbe && !input.gitTransportProbe.startsWith('error')
        ? 'origin readable'
        : 'origin read failed';

  const deps =
    input.nodeModules && existsSync(join(cwd, 'scripts/dependency-state.mjs'))
      ? 'node_modules present (run deps:reconcile after lock changes)'
      : input.nodeModules
        ? 'node_modules present'
        : 'node_modules missing — run node scripts/dependency-state.mjs reconcile';

  return {
    agentRuntime: input.agentRuntime ?? 'unknown-local',
    head: input.head,
    branch: input.branch,
    originMain: input.originMain,
    worktreeClean: input.worktreeClean,
    gitTransport,
    ghApi: input.ghApiProbe?.startsWith('error')
      ? input.ghApiProbe
      : input.ghApiProbe
        ? `authenticated (${input.ghApiProbe})`
        : input.ghAuth,
    node: process.version,
    packageManager: pkg.packageManager ?? 'unknown',
    enginesNode: pkg.engines?.node ?? 'unknown',
    deps,
    signingDoctor: 'run pnpm run signing:doctor',
    ciPrepush: 'run pnpm run ci:prepush before push',
    docs: 'docs/CURSOR-CLOUD-AGENT.md',
  };
}

function collectLiveSummary() {
  const pkg = readPackageJson();
  const head = runGit(['rev-parse', 'HEAD']);
  const branch = runGit(['branch', '--show-current']);
  const originMain = runGit(['rev-parse', 'origin/main']);
  const worktreeClean = runGit(['status', '--porcelain']) === '';

  let ghAuth = 'not checked';
  try {
    ghAuth = runGh(['auth', 'status']);
  } catch {
    ghAuth = 'unavailable';
  }

  const ghApiProbe = isOfflineDoctorMode()
    ? 'offline-skipped'
    : runGh(['api', 'user', '-q', '.login']);
  const gitTransportProbe = isOfflineDoctorMode()
    ? 'offline-skipped'
    : runGit(['ls-remote', '--heads', 'origin', 'main']);
  const nodeModules = existsSync(join(cwd, 'node_modules'));
  const agentRuntime =
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: optional Cursor Cloud session markers for diagnostics only
    process.env.CURSOR_CLOUD === '1' || process.env.CURSOR_AGENT ? 'cursor-cloud' : 'unknown-local';

  return buildSummary({
    head,
    branch,
    originMain,
    worktreeClean,
    gitTransportProbe,
    ghApiProbe,
    ghAuth,
    nodeModules,
    pkg,
    agentRuntime,
  });
}

function main() {
  const summary = collectLiveSummary();

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 0)}\n`);
  } else {
    console.log(`AGENT_RUNTIME=${summary.agentRuntime}`);
    console.log(`HEAD=${summary.head ?? 'unknown'}`);
    console.log(`BRANCH=${summary.branch ?? 'unknown'}`);
    console.log(`ORIGIN_MAIN=${summary.originMain ?? 'unknown'}`);
    console.log(`WORKTREE_CLEAN=${summary.worktreeClean ? 'yes' : 'no'}`);
    console.log(`GIT_TRANSPORT=${summary.gitTransport}`);
    console.log(`GH_API=${summary.ghApi}`);
    console.log(`NODE=${summary.node}`);
    console.log(`PNPM=${summary.packageManager}`);
    console.log(`DEPS=${summary.deps}`);
    console.log(`SIGNING=${summary.signingDoctor}`);
    console.log(`CI_PREPUSH=${summary.ciPrepush}`);
    console.log(`DOCS=${summary.docs}`);
  }

  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
