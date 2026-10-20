import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { acquireLock } from './lock.mjs';

// QNBS-v3: this entry file statically imports only Node built-ins and the lock, so the runner modules that read or delete anything are loaded only after the source check has passed.
const MODES = new Set(['dry-run', 'reconcile']);
const SCRIPT_KEYS = ['vercel:retention:dry-run', 'vercel:retention:reconcile'];
const TRUSTED_PATHS = ['scripts/vercel-retention', '.github/vercel-retention-holds.json'];
const HOLDS_PATH = '.github/vercel-retention-holds.json';

const stop = (reason) => {
  throw Object.assign(new Error(reason), { reason });
};

// QNBS-v3: retention is a Node 22 operator contract, independent of the application's Node 22/24 CI matrix; reject the actual runtime before tools, locks or runner imports.
export function assertRuntime(version = process.versions.node) {
  const match = typeof version === 'string' && /^22\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (
    !match ||
    match[0] !== version ||
    !Number.isSafeInteger(Number(match[1])) ||
    !Number.isSafeInteger(Number(match[2])) ||
    Number(match[1]) < 19
  )
    stop('runtime-mismatch');
}

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    return stop(`unparseable-${what}`);
  }
}

// QNBS-v3: the entry points take no arguments, so a command-line allow rule for them cannot be widened by appending text.
export function parseMode(argv) {
  if (argv.length !== 1 || !MODES.has(argv[0])) stop('invalid-arguments');
  return argv[0];
}

const mainScripts = (deps) =>
  parse(deps.git(['show', 'origin/main:package.json']), 'main-package').scripts ?? {};

// QNBS-v3: a mutating pass runs only from runner files, holds and package scripts that equal the reviewed origin/main. This guards against an accidental or stale checkout; a hostile checkout can edit this check too, so the pass belongs in a clean main worktree.
export function assertTrustedSource(deps) {
  deps.git(['fetch', 'origin', 'main', '--quiet']);
  const dirty = deps.git(['status', '--porcelain', '--', ...TRUSTED_PATHS, 'package.json']).trim();
  if (dirty !== '') stop('runner-source-modified');
  try {
    deps.git(['diff', '--quiet', 'origin/main', '--', ...TRUSTED_PATHS]);
  } catch {
    stop('runner-source-differs-from-main');
  }
  const mine = parse(deps.packageJson(), 'package').scripts ?? {};
  const main = mainScripts(deps);
  for (const key of SCRIPT_KEYS)
    if (mine[key] !== main[key]) stop('package-script-differs-from-main');
}

const rowLine = (row) =>
  [
    row.id,
    row.verdict,
    row.branch ?? '-',
    `PR ${row.pr ?? '-'}`,
    row.sha || '-',
    `${row.state}/${row.target}`,
    row.created,
    `aliases=${row.aliases.join(',') || '-'}`,
    row.lifecycle,
    row.reasons.join('+') || '-',
  ].join(' | ');

export function printManifest(io, manifest) {
  for (const row of manifest) io.log(`RETENTION_MANIFEST ${rowLine(row)}`);
}

export function report(io, summary) {
  const { manifest, ...rest } = summary;
  io.log(`RETENTION_SUMMARY ${JSON.stringify(rest)}`);
}

// QNBS-v3: the manifest is printed from the plan, before the first write, so an operator can read exactly what a reconcile pass is about to do; the summary line follows the pass.
export async function main(argv, deps, io = console) {
  assertRuntime();
  const mode = parseMode(argv);
  if (mode === 'reconcile') assertTrustedSource(deps);
  const { runRetention } = await import('./apply.mjs');
  report(io, await runRetention(deps, mode, (plan) => printManifest(io, plan.manifest)));
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
    holds: () => readFileSync(HOLDS_PATH, 'utf8'),
    lock: () => acquireLock(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), realDeps()).catch((error) => {
    if (error.summary) report(console, error.summary);
    console.error(`RETENTION_STOP: ${error.reason ?? 'unexpected-error'}`);
    process.exitCode = 1;
  });
}
