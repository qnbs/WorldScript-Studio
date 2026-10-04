#!/usr/bin/env node
/**
 * Non-secret diagnostics for Cursor Cloud Agent sessions.
 * Does not replace signing:doctor, ci:prepush, or GitHub merge authority.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const jsonMode = process.argv.includes('--json');
const cwd = process.cwd();

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.()?.trim();
    return stderr ? `error: ${stderr.split('\n')[0]}` : 'unavailable';
  }
}

function readPackageJson() {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

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

const ghApiProbe = runGh(['api', 'user', '-q', '.login']);
const gitTransportProbe = runGit(['ls-remote', '--heads', 'origin', 'main']);
const gitTransport =
  gitTransportProbe && !gitTransportProbe.startsWith('error')
    ? 'origin readable'
    : 'origin read failed';

const nodeModules = existsSync(join(cwd, 'node_modules'));
const deps =
  nodeModules && existsSync(join(cwd, 'scripts/dependency-state.mjs'))
    ? 'node_modules present (run deps:reconcile after lock changes)'
    : nodeModules
      ? 'node_modules present'
      : 'node_modules missing — run node scripts/dependency-state.mjs reconcile';

const agentRuntime =
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: optional Cursor Cloud session markers for diagnostics only
  process.env.CURSOR_CLOUD === '1' || process.env.CURSOR_AGENT ? 'cursor-cloud' : 'unknown-local';

const summary = {
  agentRuntime,
  head,
  branch,
  originMain,
  worktreeClean,
  gitTransport,
  ghApi: ghApiProbe?.startsWith('error')
    ? ghApiProbe
    : ghApiProbe
      ? `authenticated (${ghApiProbe})`
      : ghAuth,
  node: process.version,
  packageManager: pkg.packageManager ?? 'unknown',
  enginesNode: pkg.engines?.node ?? 'unknown',
  deps,
  signingDoctor: 'run pnpm run signing:doctor',
  ciPrepush: 'run pnpm run ci:prepush before push',
  docs: 'docs/CURSOR-CLOUD-AGENT.md',
};

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
