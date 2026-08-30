#!/usr/bin/env node
/**
 * Install graphifyy at the exact version pinned in config/graph-tools-versions.json.
 * Tries uv, then pipx, then pip (in that priority order) — whichever is available on this
 * machine — always the pinned version. Never falls through to an unpinned "latest" install;
 * fails loudly instead so version drift is a visible decision, not a silent side effect.
 * Run once per machine, then `pnpm run graphify:update`. See docs/graphify.md
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchesExactVersion } from './graphSourceFingerprint.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'config', 'graph-tools-versions.json'), 'utf-8'));
const version = policy.graphifyy.testedVersion;
const pinnedSpec = `graphifyy==${version}`;

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

/** @param {string} cmd @param {string[]} args */
function capture(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: 'utf-8',
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function quoteWindowsCommandArg(value) {
  if (/\r|\n/.test(value)) throw new Error('Windows command arguments cannot contain newlines');
  return `"${value.replaceAll('"', '\\"')}"`;
}

function runResolvedCommand(command, args, options = {}) {
  const isWindowsShim = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
  const invocation = isWindowsShim
    ? {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `"${[command, ...args].map(quoteWindowsCommandArg).join(' ')}"`],
      }
    : { command, args };
  return spawnSync(invocation.command, invocation.args, {
    ...options,
    encoding: 'utf-8',
    env: process.env,
    shell: false,
  });
}

/**
 * Resolve the launcher selected by an installer, retaining its path even when its bin directory
 * is not present in PATH. The fallback wrapper remains the compatibility path for pip installs.
 */
export function resolveGraphifyExecutable() {
  for (const installer of ['uv', 'pipx']) {
    const executable = resolveInstallerExecutable(installer);
    if (executable) return executable;
  }
  return process.platform === 'win32' ? 'graphify.exe' : 'graphify';
}

/** @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
export function runGraphifyCommand(args, options = {}) {
  const executable = resolveGraphifyExecutable();
  const result = runResolvedCommand(executable, args, options);
  if (!result.error && result.status !== 127 && result.status !== 9009) return result;
  return spawnSync(process.execPath, [join(root, 'scripts', 'graphify-cli.mjs'), ...args], {
    ...options,
    env: process.env,
  });
}

// QNBS-v3: verify Python fallback installs through the interpreter that installed Graphify.
export const graphifyVersionCommand = (tool) =>
  tool === 'py' ? ['-3', '-m', 'graphify', '--version'] : ['-m', 'graphify', '--version'];

function isUnavailable(result) {
  return (
    result.error?.code === 'ENOENT' ||
    result.status === 127 ||
    result.status === 9009 ||
    /No module named ["']?pip["']?/i.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  );
}

/**
 * @param {'uv'|'pipx'} installer
 * @param {string} binDirectory
 * @param {NodeJS.Platform} [platform]
 */
function installerExecutableCandidates(installer, binDirectory, platform = process.platform) {
  if (installer !== 'uv' && installer !== 'pipx') return [];
  const names = platform === 'win32' ? ['graphify.exe', 'graphify.cmd', 'graphify'] : ['graphify'];
  return names.map((name) => join(binDirectory, name));
}

/** @param {'uv'|'pipx'} installer */
function installerBinDirectory(installer) {
  const args =
    installer === 'uv' ? ['tool', 'dir', '--bin'] : ['environment', '--value', 'PIPX_BIN_DIR'];
  const result = capture(installer, args);
  if (result.status !== 0 || result.error) return null;
  const binDirectory = result.stdout?.trim();
  return binDirectory || null;
}

/** @param {'uv'|'pipx'} installer */
function resolveInstallerExecutable(installer) {
  const binDirectory = installerBinDirectory(installer);
  if (!binDirectory) return null;
  return (
    installerExecutableCandidates(installer, binDirectory).find((candidate) =>
      existsSync(candidate),
    ) ?? null
  );
}

/** @param {'uv'|'pipx'} installer */
function verifyInstallerExecutable(installer) {
  const executable = resolveInstallerExecutable(installer);
  if (!executable) {
    return {
      status: 1,
      output: '',
      error: `could not resolve graphify from ${installer}'s application-bin directory`,
    };
  }
  const result = runResolvedCommand(executable, ['--version']);
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    error: result.error?.message ?? '',
  };
}

const attempts = [
  { tool: 'uv', args: ['tool', 'install', '--force', pinnedSpec] },
  { tool: 'pipx', args: ['install', '--force', pinnedSpec] },
  ...(process.platform === 'win32'
    ? [
        { tool: 'python', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'python3', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'py', args: ['-3', '-m', 'pip', 'install', pinnedSpec] },
      ]
    : [
        { tool: 'python3', args: ['-m', 'pip', 'install', pinnedSpec] },
        { tool: 'python', args: ['-m', 'pip', 'install', pinnedSpec] },
      ]),
];

function main() {
  for (const { tool, args } of attempts) {
    if (tool === 'python' || tool === 'python3' || tool === 'py') {
      const pipArgs = tool === 'py' ? ['-3', '-m', 'pip', '--version'] : ['-m', 'pip', '--version'];
      const pipProbe = capture(tool, pipArgs);
      if (isUnavailable(pipProbe)) continue;
      if (pipProbe.status !== 0 || pipProbe.error) {
        process.stderr.write(
          `[graphify-bootstrap] ${tool} could not verify its pip module; refusing an unintended fallback.\n`,
        );
        process.exit(pipProbe.status ?? 1);
      }
    }
    const result = run(tool, args);
    if (result.error?.code && result.error.code !== 'ENOENT') {
      process.stderr.write(`[graphify-bootstrap] ${tool} failed: ${result.error.message}\n`);
      process.exit(1);
    }
    if (result.status !== 0 && !isUnavailable(result)) {
      process.stderr.write(
        `[graphify-bootstrap] ${tool} could not install ${pinnedSpec}; refusing an unintended fallback.\n`,
      );
      process.exit(result.status ?? 1);
    }
    if (isUnavailable(result)) continue;
    if (result.status === 0) {
      // QNBS-v3: verify the installer-owned executable so PATH drift cannot mask version mismatches.
      const verify =
        tool === 'uv' || tool === 'pipx'
          ? verifyInstallerExecutable(tool)
          : (() => {
              const fallback = runResolvedCommand(tool, graphifyVersionCommand(tool));
              return {
                status: fallback.status,
                output: `${fallback.stdout ?? ''}\n${fallback.stderr ?? ''}`,
                error: fallback.error?.message ?? '',
              };
            })();
      if (verify.status === 0 && matchesExactVersion(verify.output, version)) {
        console.log(`[graphify-bootstrap] Installed ${pinnedSpec} via ${tool} (verified).`);
        process.exit(0);
      }
      process.stderr.write(
        `[graphify-bootstrap] ${tool} installed ${pinnedSpec}, but its resolved launcher did not verify version ${version}.` +
          (verify.error ? ` ${verify.error}` : '') +
          '\n',
      );
      process.exit(1);
    }
  }

  process.stderr.write(
    `[graphify-bootstrap] Could not install ${pinnedSpec} via uv, pipx, or pip.\n` +
      `Install one of those tools, or install manually:\n` +
      `  uv tool install --force ${pinnedSpec}\n` +
      `  pipx install --force ${pinnedSpec}\n` +
      `  python -m pip install ${pinnedSpec}\n` +
      `PyPI package name is graphifyy (two y's), CLI command remains: graphify\n`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
