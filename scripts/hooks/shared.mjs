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

export function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, script), ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  return result.error ? 1 : (result.status ?? 1);
}

export function runLocalBinary(binary, args = []) {
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
    return 1;
  }
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  return result.error ? 1 : (result.status ?? 1);
}
