import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyDependencyState } from '../dependency-state.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function ensureDependencyState() {
  try {
    verifyDependencyState(projectRoot);
    return true;
  } catch (error) {
    console.error(`[hook] ${error instanceof Error ? error.message : String(error)}`);
    console.error('[hook] The hook was not bypassed. Reconcile dependencies, then retry.');
    return false;
  }
}

// QNBS-v3: bound hook children so timeout or resource termination is observable instead of an implicit pass.
function runBounded(command, args, { timeoutMs = 120_000, env, input, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    input,
    shell,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  return {
    status: result.error ? null : result.status,
    signal: result.signal,
    error: result.error,
    timedOut: result.error?.code === 'ETIMEDOUT',
    command,
  };
}

export function runNodeScriptDetailed(script, args = [], options = {}) {
  return runBounded(process.execPath, [resolve(projectRoot, script), ...args], options);
}

export function runNodeScript(script, args = [], options = {}) {
  const result = runNodeScriptDetailed(script, args, options);
  return result.error ? 1 : (result.status ?? 1);
}

export function runLocalBinaryDetailed(binary, args = [], options = {}) {
  const command = resolve(
    projectRoot,
    'node_modules',
    '.bin',
    `${binary}${process.platform === 'win32' ? '.cmd' : ''}`,
  );
  if (!existsSync(command)) {
    console.error(
      `[hook] Required local binary is missing: ${binary}. Run: node scripts/dependency-state.mjs reconcile`,
    );
    return {
      status: 1,
      signal: null,
      error: new Error(`Missing local binary: ${binary}`),
      timedOut: false,
      command,
    };
  }
  return runBounded(command, args, { ...options, shell: process.platform === 'win32' });
}

export function runLocalBinary(binary, args = [], options = {}) {
  const result = runLocalBinaryDetailed(binary, args, options);
  return result.error ? 1 : (result.status ?? 1);
}
