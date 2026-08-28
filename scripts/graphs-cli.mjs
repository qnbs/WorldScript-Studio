#!/usr/bin/env node
/**
 * Dual-graph orchestration CLI: `node scripts/graphs-cli.mjs <bootstrap|doctor|status|update|report|refresh>`.
 *
 * Every command's mutation scope is unambiguous:
 *   bootstrap — installs both tools at their pinned versions. Never touches the repo.
 *   doctor    — read-only diagnostics. No mutation.
 *   status    — fast, read-only freshness check. No mutation.
 *   update    — updates LOCAL RUNTIME STATE only (Graphify build, CodeGraph incremental sync).
 *               Never touches the committed report files.
 *   report    — the ONLY command that writes graphify-out/GRAPH_REPORT.md or
 *               .codegraph/CODEGRAPH_REPORT.md. Gated on a clean source tree.
 *   refresh   — update then report, strict: fails non-zero if either tool can't update or
 *               report generation is refused/fails. This is what PR preparation runs.
 *
 * Status vocabulary: PASS, UPDATED, FRESH, STALE, VERSION_MISMATCH, SKIPPED_NOT_INSTALLED,
 * SKIPPED_NOT_INITIALIZED, SKIPPED_NOT_CONFIGURED, DIRTY_UNTRACKED_INPUT, FAIL. An installed tool
 * returning non-zero is always FAIL. No command ever prints a success epilogue after a swallowed
 * failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSourceFingerprint, ROOT } from './graphSourceFingerprint.mjs';

const POLICY_PATH = join(ROOT, 'config', 'graph-tools-versions.json');
const GRAPHIFY_REPORT = join(ROOT, 'graphify-out', 'GRAPH_REPORT.md');
const CODEGRAPH_REPORT = join(ROOT, '.codegraph', 'CODEGRAPH_REPORT.md');
const CODEGRAPH_DB = join(ROOT, '.codegraph', 'codegraph.db');

function loadPolicy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf-8'));
}

function runNode(script, args = []) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

function commandVersion(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (result.error?.code === 'ENOENT' || result.status == null) return null;
  return (result.stdout ?? '').trim() || null;
}

/** Extracts the first `Report schema: N` / `Source fingerprint: sha256:...` / `Tool version: X`
 * lines from a committed report's metadata block. Returns null fields if the report is absent. */
function readReportMetadata(path) {
  if (!existsSync(path)) return { exists: false };
  const text = readFileSync(path, 'utf-8');
  const schema = text.match(/Report schema:\s*(\S+)/)?.[1] ?? null;
  const fingerprint = text.match(/Source fingerprint:\s*(\S+)/)?.[1] ?? null;
  const toolVersion = text.match(/Tool version:\s*(\S+)/)?.[1] ?? null;
  return { exists: true, schema, fingerprint, toolVersion };
}

function doctor() {
  const policy = loadPolicy();
  const graphifyVersion = commandVersion('graphify');
  const codegraphVersion = commandVersion('codegraph');
  const codegraphInitialized = existsSync(CODEGRAPH_DB);

  console.log('=== graphs:doctor ===');
  console.log(
    `graphifyy: ${graphifyVersion ? `installed ${graphifyVersion}` : 'SKIPPED_NOT_INSTALLED'} ` +
      `(policy: ${policy.graphifyy.testedVersion}, ${policy.graphifyy.policy})`,
  );
  if (graphifyVersion && !graphifyVersion.includes(policy.graphifyy.testedVersion)) {
    console.log('  -> VERSION_MISMATCH (run `pnpm run graphify:bootstrap` to align)');
  }
  console.log(
    `@colbymchenry/codegraph: ${codegraphVersion ? `installed ${codegraphVersion}` : 'SKIPPED_NOT_INSTALLED'} ` +
      `(policy: ${policy.codegraph.testedVersion}, ${policy.codegraph.policy})`,
  );
  if (codegraphVersion && !codegraphVersion.includes(policy.codegraph.testedVersion)) {
    console.log('  -> VERSION_MISMATCH (run `pnpm run codegraph:bootstrap` to align)');
  }
  console.log(
    `CodeGraph local index: ${codegraphInitialized ? 'PASS (initialized)' : 'SKIPPED_NOT_INITIALIZED'}`,
  );

  for (const [label, path] of [
    ['Graphify report', GRAPHIFY_REPORT],
    ['CodeGraph report', CODEGRAPH_REPORT],
  ]) {
    const meta = readReportMetadata(path);
    console.log(
      meta.exists
        ? `${label}: schema=${meta.schema ?? '?'} toolVersion=${meta.toolVersion ?? '?'} fingerprint=${meta.fingerprint ?? '?'}`
        : `${label}: SKIPPED_NOT_CONFIGURED (not generated yet)`,
    );
  }

  console.log(
    'Privacy: run `graphify --help` / `codegraph telemetry status` to confirm local query-log and ' +
      'telemetry preferences (both local-only, never committed).',
  );
}

function status() {
  const currentFingerprint = computeSourceFingerprint();
  let anyStale = false;
  for (const [label, path] of [
    ['graphify-out/GRAPH_REPORT.md', GRAPHIFY_REPORT],
    ['.codegraph/CODEGRAPH_REPORT.md', CODEGRAPH_REPORT],
  ]) {
    const meta = readReportMetadata(path);
    if (!meta.exists) {
      console.log(`${label}: SKIPPED_NOT_CONFIGURED`);
      continue;
    }
    const isFresh = meta.fingerprint === currentFingerprint;
    if (!isFresh) anyStale = true;
    console.log(`${label}: ${isFresh ? 'FRESH' : 'STALE'}`);
  }
  process.exit(anyStale ? 1 : 0);
}

function update() {
  const policy = loadPolicy();
  let failed = false;

  if (commandVersion('graphify')) {
    const r = runNode('graphify-update.mjs');
    console.log(
      r.status === 0 ? '[graphs:update] graphify: UPDATED' : '[graphs:update] graphify: FAIL',
    );
    if (r.status !== 0) failed = true;
  } else {
    console.log('[graphs:update] graphify: SKIPPED_NOT_INSTALLED');
  }

  if (existsSync(CODEGRAPH_DB)) {
    const r = spawnSync('codegraph', ['sync'], { cwd: ROOT, stdio: 'inherit' });
    console.log(
      r.status === 0
        ? '[graphs:update] codegraph: UPDATED (sync)'
        : '[graphs:update] codegraph: FAIL',
    );
    if (r.status !== 0) failed = true;
  } else if (commandVersion('codegraph')) {
    console.log('[graphs:update] codegraph: SKIPPED_NOT_INITIALIZED (run `codegraph init` first)');
  } else {
    console.log('[graphs:update] codegraph: SKIPPED_NOT_INSTALLED');
  }

  void policy;
  process.exit(failed ? 1 : 0);
}

function report() {
  let failed = false;
  if (commandVersion('graphify')) {
    const r = runNode('graphify-report.mjs');
    if (r.status !== 0) failed = true;
  } else {
    console.log('[graphs:report] graphify: SKIPPED_NOT_INSTALLED');
  }
  if (existsSync(CODEGRAPH_DB)) {
    const r = runNode('codegraph-report.mjs');
    if (r.status !== 0) failed = true;
  } else {
    console.log('[graphs:report] codegraph: SKIPPED_NOT_INITIALIZED');
  }
  process.exit(failed ? 1 : 0);
}

function refresh() {
  console.log('[graphs:refresh] strict mode — update then report, any real failure is fatal.');
  const updateResult = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'graphs-cli.mjs'), 'update'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  if (updateResult.status !== 0) {
    console.error('[graphs:refresh] FAIL — update stage failed.');
    process.exit(1);
  }
  const reportResult = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'graphs-cli.mjs'), 'report'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  if (reportResult.status !== 0) {
    console.error('[graphs:refresh] FAIL — report stage failed.');
    process.exit(1);
  }
  console.log('[graphs:refresh] PASS');
}

function bootstrap() {
  const graphifyResult = runNode('graphify-bootstrap.mjs');
  const codegraphResult = runNode('codegraph-bootstrap.mjs');
  const failed = graphifyResult.status !== 0 || codegraphResult.status !== 0;
  process.exit(failed ? 1 : 0);
}

const command = process.argv[2];
const commands = { bootstrap, doctor, status, update, report, refresh };

if (!command || !(command in commands)) {
  console.error(`Usage: node scripts/graphs-cli.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}

commands[command]();
