import { spawn, spawnSync } from 'node:child_process';
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
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      shell,
      detached: process.platform !== 'win32',
      stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    });
    let timedOut = false;
    let settled = false;
    let forceTimer;
    const terminate = (signal) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child when a process group is unavailable.
        }
      } else if (process.platform === 'win32' && child.pid) {
        const result = spawnSync(
          'taskkill',
          ['/pid', String(child.pid), '/t', ...(signal === 'SIGKILL' ? ['/f'] : [])],
          { windowsHide: true, stdio: 'ignore' },
        );
        if (result.status === 0) return;
      }
      child.kill(signal);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      forceTimer = setTimeout(() => terminate('SIGKILL'), 1_000);
    }, timeoutMs);
    const signalHandlers = new Map();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => terminate(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    const finish = (status, signal, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      // QNBS-v3: retain forced process-group cleanup after timeout even when the leader exits early.
      if (forceTimer && !timedOut) clearTimeout(forceTimer);
      for (const [parentSignal, handler] of signalHandlers) {
        process.removeListener(parentSignal, handler);
      }
      resolveResult({ status: error ? null : status, signal, error, timedOut, command });
    };
    child.once('error', (error) => finish(null, null, error));
    child.once('close', (status, signal) => finish(status, signal));
    if (input !== undefined) {
      child.stdin.once('error', (error) => {
        if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) finish(null, null, error);
      });
      child.stdin.end(input);
    }
  });
}

export async function runNodeScriptDetailed(script, args = [], options = {}) {
  return runBounded(process.execPath, [resolve(projectRoot, script), ...args], options);
}

export async function runNodeScript(script, args = [], options = {}) {
  const result = await runNodeScriptDetailed(script, args, options);
  return result.error ? 1 : (result.status ?? 1);
}

export async function runLocalBinaryDetailed(binary, args = [], options = {}) {
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

export async function runLocalBinary(binary, args = [], options = {}) {
  const result = await runLocalBinaryDetailed(binary, args, options);
  return result.error ? 1 : (result.status ?? 1);
}
