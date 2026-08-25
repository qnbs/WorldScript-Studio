import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyDependencyState } from '../dependency-state.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function ensureDependencyState(root = projectRoot) {
  try {
    verifyDependencyState(root);
    return true;
  } catch (error) {
    console.error(`[hook] ${error instanceof Error ? error.message : String(error)}`);
    console.error('[hook] The hook was not bypassed. Reconcile dependencies, then retry.');
    return false;
  }
}

// QNBS-v3: bound hook children so timeout or resource termination is observable instead of an implicit pass.
export function runBounded(
  command,
  args,
  {
    timeoutMs = 120_000,
    env,
    input,
    shell = false,
    cwd = projectRoot,
    detached = process.platform !== 'win32',
  } = {},
) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      detached: detached && process.platform !== 'win32',
      stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    });
    let timedOut = false;
    let interrupted = false;
    let terminationRequested = false;
    let cleanupStarted = false;
    let cleanupDeadline = 0;
    let pendingFinish = null;
    let state = 'RUNNING';
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
      try {
        child.kill(signal);
      } catch {
        // The child may have exited between process-group and direct cleanup attempts.
      }
    };
    const cleanupComplete = () => {
      if (!child.pid) return true;
      if (process.platform === 'win32') {
        // QNBS-v3: taskkill /f returning does not prove the tree exited; poll tasklist instead.
        const result = spawnSync('tasklist', ['/fi', `PID eq ${child.pid}`, '/fo', 'csv', '/nh'], {
          windowsHide: true,
        });
        return !(result.stdout ?? '').toString().includes(String(child.pid));
      }
      try {
        process.kill(-child.pid, 0);
        return false;
      } catch (error) {
        // QNBS-v3: EPERM means the group still exists; only ESRCH proves it is gone.
        return error?.code === 'ESRCH' || error?.code === 'EPERM';
      }
    };
    const finishAfterCleanup = () => {
      if (!cleanupComplete() && Date.now() < cleanupDeadline) {
        setTimeout(finishAfterCleanup, 20);
        return;
      }
      complete(
        pendingFinish?.status ?? null,
        pendingFinish?.signal ?? 'SIGKILL',
        pendingFinish?.error ?? null,
      );
    };
    const beginForceCleanup = () => {
      if (cleanupStarted || state === 'SETTLED') return;
      cleanupStarted = true;
      state = 'FORCE_CLEANUP_RUNNING';
      if (forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = undefined;
      }
      terminate('SIGKILL');
      cleanupDeadline = Date.now() + 1_000;
      finishAfterCleanup();
    };
    const scheduleForceTermination = () => {
      if (forceTimer) clearTimeout(forceTimer);
      state = 'FORCE_CLEANUP_PENDING';
      forceTimer = setTimeout(() => {
        forceTimer = undefined;
        beginForceCleanup();
      }, 1_000);
    };
    const requestTermination = (signal, reason, error = null) => {
      if (reason === 'timeout') timedOut = true;
      else if (reason === 'interrupt') interrupted = true;
      if (error) pendingFinish = { status: null, signal: null, error };
      if (terminationRequested) {
        // QNBS-v3: a repeated parent signal must force-clean detached children before the grace timer.
        beginForceCleanup();
        return;
      }
      terminationRequested = true;
      state = 'TERMINATION_REQUESTED';
      terminate(signal);
      scheduleForceTermination();
    };
    const timeoutTimer = setTimeout(() => requestTermination('SIGTERM', 'timeout'), timeoutMs);
    const signalHandlers = new Map();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        requestTermination(signal, 'interrupt');
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    const complete = (status, signal, error = null) => {
      if (settled) return;
      settled = true;
      state = 'SETTLED';
      clearTimeout(timeoutTimer);
      if (forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = undefined;
      }
      for (const [parentSignal, handler] of signalHandlers) {
        process.removeListener(parentSignal, handler);
      }
      resolveResult({
        status: error ? null : status,
        signal,
        error,
        timedOut,
        interrupted,
        command,
      });
    };
    const finish = (status, signal, error = null) => {
      if (settled) return;
      if (terminationRequested) {
        // QNBS-v3: leader close never proves descendants are gone; force cleanup remains authoritative.
        pendingFinish ??= { status, signal, error };
        state = 'CLOSED';
        beginForceCleanup();
        return;
      }
      complete(status, signal, error);
    };
    child.once('error', (error) => finish(null, null, error));
    child.once('close', (status, signal) => finish(status, signal));
    if (input !== undefined) {
      child.stdin.once('error', (error) => {
        if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code))
          requestTermination('SIGTERM', 'resource', error);
      });
      child.stdin.end(input);
    }
  });
}

export async function runNodeScriptDetailed(script, args = [], options = {}) {
  const root = options.root ?? projectRoot;
  return runBounded(process.execPath, [resolve(root, script), ...args], {
    ...options,
    cwd: options.cwd ?? root,
  });
}

export async function runNodeScript(script, args = [], options = {}) {
  const result = await runNodeScriptDetailed(script, args, options);
  return result.error || result.timedOut || result.interrupted ? 1 : (result.status ?? 1);
}

export async function runLocalBinaryDetailed(binary, args = [], options = {}) {
  const root = options.root ?? projectRoot;
  const command = resolve(
    root,
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
      interrupted: false,
      command,
    };
  }
  return runBounded(command, args, {
    ...options,
    cwd: options.cwd ?? root,
    shell: process.platform === 'win32',
  });
}

export async function runLocalBinary(binary, args = [], options = {}) {
  const result = await runLocalBinaryDetailed(binary, args, options);
  return result.error || result.timedOut || result.interrupted ? 1 : (result.status ?? 1);
}
