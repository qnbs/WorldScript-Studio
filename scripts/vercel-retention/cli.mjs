import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runRetention } from './apply.mjs';
import { parseJson, refuse } from './util.mjs';

const MODES = new Set(['dry-run', 'reconcile']);
const SCRIPT_KEYS = ['vercel:retention:dry-run', 'vercel:retention:reconcile'];
const RUNNER_PATH = 'scripts/vercel-retention';

// QNBS-v3: the entry points take no arguments, so a command-line allow rule for them cannot be widened by appending text.
export function parseMode(argv) {
  if (argv.length !== 1 || !MODES.has(argv[0])) refuse('invalid-arguments');
  return argv[0];
}

const mainScripts = (deps) =>
  parseJson(deps.git(['show', 'origin/main:package.json']), 'main-package').scripts ?? {};

// QNBS-v3: a mutating pass runs only from runner files and package scripts that equal the reviewed origin/main, so an edited or unmerged checkout cannot delete anything.
export function assertTrustedSource(deps) {
  deps.git(['fetch', 'origin', 'main', '--quiet']);
  const dirty = deps.git(['status', '--porcelain', '--', RUNNER_PATH, 'package.json']).trim();
  if (dirty !== '') refuse('runner-source-modified');
  try {
    deps.git(['diff', '--quiet', 'origin/main', '--', RUNNER_PATH]);
  } catch {
    refuse('runner-source-differs-from-main');
  }
  const mine = parseJson(deps.packageJson(), 'package').scripts ?? {};
  const main = mainScripts(deps);
  for (const key of SCRIPT_KEYS)
    if (mine[key] !== main[key]) refuse('package-script-differs-from-main');
}

export async function main(argv, deps, io = console) {
  const mode = parseMode(argv);
  if (mode === 'reconcile') assertTrustedSource(deps);
  const summary = await runRetention(deps, mode);
  io.log(`RETENTION_SUMMARY ${JSON.stringify(summary)}`);
}

function realDeps() {
  const env = { ...process.env, NO_UPDATE_NOTIFIER: '1', VERCEL_TELEMETRY_DISABLED: '1' };
  const run = (command, args) =>
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    });
  return {
    vercel: (args) => run('vercel', args),
    gh: (args) => run('gh', args),
    git: (args) => run('git', args),
    http: (url) =>
      run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', url]).trim(),
    packageJson: () => readFileSync('package.json', 'utf8'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), realDeps()).catch((error) => {
    if (error.summary) console.log(`RETENTION_SUMMARY ${JSON.stringify(error.summary)}`);
    console.error(`RETENTION_STOP: ${error.reason ?? 'unexpected-error'}`);
    process.exitCode = 1;
  });
}
