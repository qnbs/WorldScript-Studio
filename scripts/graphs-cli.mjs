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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeCodegraph } from './codegraph-report.mjs';
import {
  checkCleanState,
  computeSourceFingerprint,
  matchesExactVersion,
  ROOT,
} from './graphSourceFingerprint.mjs';

const POLICY_PATH = join(ROOT, 'config', 'graph-tools-versions.json');
const GRAPHIFY_REPORT = join(ROOT, 'graphify-out', 'GRAPH_REPORT.md');
const CODEGRAPH_REPORT = join(ROOT, '.codegraph', 'CODEGRAPH_REPORT.md');
const CODEGRAPH_DB = join(ROOT, '.codegraph', 'codegraph.db');

function loadPolicy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf-8'));
}

function runNode(script, args = [], options = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

export function isSupportedCommand(command, availableCommands) {
  return Boolean(command) && Object.hasOwn(availableCommands, command);
}

export function strictRefreshFailure({ updateStatus, reportStatus, reportsFresh }) {
  if (updateStatus !== 0) return 'update stage failed';
  if (reportStatus !== 0) return 'report stage failed';
  if (!reportsFresh) return 'final freshness check failed';
  return null;
}

function runTool(command, args, options = {}) {
  if (command === 'codegraph') return executeCodegraph(args, options);
  return spawnSync(command, args, { cwd: ROOT, env: process.env, ...options });
}

function commandVersion(cmd, args = ['--version']) {
  const result =
    cmd === 'graphify'
      ? runNode('graphify-cli.mjs', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
      : runTool(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error?.code === 'ENOENT' || result.status == null || result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

function requireToolVersion(command, expected) {
  const output = commandVersion(command);
  if (!output) throw new Error(`${command} is not available`);
  if (!matchesExactVersion(output, expected)) {
    throw new Error(`${command} version mismatch: expected ${expected}, got ${output}`);
  }
  return output;
}

/** Extracts the first `Report schema: N` / `Source fingerprint: sha256:...` / `Tool version: X`
 * lines from a committed report's metadata block. Returns null fields if the report is absent. */
function readReportMetadata(path) {
  if (!existsSync(path)) return { exists: false };
  const text = readFileSync(path, 'utf-8');
  const schema = text.match(/Report schema:\s*(\S+)/)?.[1] ?? null;
  const fingerprint = text.match(/Source fingerprint:\s*(\S+)/)?.[1] ?? null;
  const toolVersion = text.match(/Tool version:\s*(\S+)/)?.[1] ?? null;
  const tool = text.match(/Tool:\s*(\S+)/)?.[1] ?? null;
  return { exists: true, schema, fingerprint, toolVersion, tool, text };
}

export function validateReportStructure(text, tool) {
  if (typeof text !== 'string') return false;
  if (tool === 'graphify') {
    return (
      text.startsWith('# Graph Report - ') &&
      text.includes('\n\n## Summary\n') &&
      /^## Top \d+ Communities by size \(of \d+ total\)$/m.test(text) &&
      text.includes('\n\n## Knowledge Gaps\n')
    );
  }
  if (tool === 'codegraph') {
    return (
      text.startsWith('# CodeGraph Report\n') &&
      text.includes('\n\n## Status\n\n```text\n') &&
      text.includes('\n\n## Files by Extension\n') &&
      text.includes('\n*Regenerate with: `pnpm run graphs:report`')
    );
  }
  return false;
}

// QNBS-v3: classify reports from schema, exact tool version, and current source fingerprint.
export function reportFreshness(meta, { reportSchemaVersion, expectedVersion }, fingerprint) {
  if (!meta.exists) return 'MISSING';
  if (meta.schema !== String(reportSchemaVersion) || meta.toolVersion !== expectedVersion) {
    return 'VERSION_MISMATCH';
  }
  if (meta.fingerprint !== fingerprint) return 'STALE';
  return validateReportStructure(meta.text, meta.tool) ? 'FRESH' : 'REPORT_INVALID';
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
  if (graphifyVersion && !matchesExactVersion(graphifyVersion, policy.graphifyy.testedVersion)) {
    console.log('  -> VERSION_MISMATCH (run `pnpm run graphify:bootstrap` to align)');
  }
  console.log(
    `@colbymchenry/codegraph: ${codegraphVersion ? `installed ${codegraphVersion}` : 'SKIPPED_NOT_INSTALLED'} ` +
      `(policy: ${policy.codegraph.testedVersion}, ${policy.codegraph.policy})`,
  );
  if (codegraphVersion && !matchesExactVersion(codegraphVersion, policy.codegraph.testedVersion)) {
    console.log('  -> VERSION_MISMATCH (run `pnpm run codegraph:bootstrap` to align)');
  }
  console.log(
    `CodeGraph local index: ${codegraphInitialized ? 'PASS (initialized)' : 'SKIPPED_NOT_INITIALIZED'}`,
  );

  const reportPaths = [
    ['Graphify report', GRAPHIFY_REPORT],
    ['CodeGraph report', CODEGRAPH_REPORT],
  ];
  let currentFingerprint = null;
  if (reportPaths.some(([, path]) => existsSync(path))) {
    try {
      currentFingerprint = computeSourceFingerprint();
    } catch (error) {
      console.log(`Report freshness: UNAVAILABLE (${error.message})`);
    }
  }
  for (const [label, path] of reportPaths) {
    const meta = readReportMetadata(path);
    console.log(
      meta.exists
        ? `${label}: schema=${meta.schema ?? '?'} toolVersion=${meta.toolVersion ?? '?'} fingerprint=${meta.fingerprint ?? '?'} ` +
            `freshness=${currentFingerprint ? reportFreshness(meta, { reportSchemaVersion: policy.reportSchemaVersion, expectedVersion: label.startsWith('Graphify') ? policy.graphifyy.testedVersion : policy.codegraph.testedVersion }, currentFingerprint) : 'UNAVAILABLE'}`
        : `${label}: SKIPPED_NOT_CONFIGURED (not generated yet)`,
    );
  }

  console.log(
    'Privacy: run `graphify --help` / `codegraph telemetry status` to confirm local query-log and ' +
      'telemetry preferences (both local-only, never committed).',
  );
}

function status() {
  const policy = loadPolicy();
  let currentFingerprint;
  try {
    currentFingerprint = computeSourceFingerprint();
  } catch (error) {
    console.error(`[graphs:status] FAIL — ${error.message}`);
    process.exit(1);
  }
  const cleanState = checkCleanState();
  let anyStale = false;
  if (!cleanState.clean) {
    console.log(`Source state: DIRTY_UNTRACKED_INPUT (${cleanState.dirtyPaths.join(', ')})`);
    anyStale = true;
  }
  for (const [label, path] of [
    ['graphify-out/GRAPH_REPORT.md', GRAPHIFY_REPORT],
    ['.codegraph/CODEGRAPH_REPORT.md', CODEGRAPH_REPORT],
  ]) {
    const meta = readReportMetadata(path);
    if (!meta.exists) {
      console.log(`${label}: MISSING`);
      anyStale = true;
      continue;
    }
    const expectedVersion = label.startsWith('graphify')
      ? policy.graphifyy.testedVersion
      : policy.codegraph.testedVersion;
    const freshness = reportFreshness(
      meta,
      { reportSchemaVersion: policy.reportSchemaVersion, expectedVersion },
      currentFingerprint,
    );
    if (freshness !== 'FRESH') anyStale = true;
    console.log(`${label}: ${freshness}`);
  }
  process.exit(anyStale ? 1 : 0);
}

function update() {
  const policy = loadPolicy();
  let failed = false;

  if (process.env.GRAPHIFY_SKIP === '1') {
    console.error(
      '[graphs:update] FAIL — GRAPHIFY_SKIP=1 is not valid for strict dual-graph update.',
    );
    process.exit(1);
  }
  try {
    requireToolVersion('graphify', policy.graphifyy.testedVersion);
    const previousReport = existsSync(GRAPHIFY_REPORT) ? readFileSync(GRAPHIFY_REPORT) : null;
    try {
      const graphifyResult = runNode('graphify-update.mjs', [], { stdio: 'inherit' });
      if (graphifyResult.status !== 0) throw new Error('Graphify update failed');
    } finally {
      if (previousReport === null) rmSync(GRAPHIFY_REPORT, { force: true });
      else writeFileSync(GRAPHIFY_REPORT, previousReport);
    }
    const restored =
      previousReport === null
        ? !existsSync(GRAPHIFY_REPORT)
        : readFileSync(GRAPHIFY_REPORT).equals(previousReport);
    if (!restored) throw new Error('committed Graphify report could not be restored');
    console.log('[graphs:update] graphify: UPDATED (committed report preserved)');
  } catch (error) {
    console.error(`[graphs:update] graphify: FAIL — ${error.message}`);
    failed = true;
  }

  try {
    requireToolVersion('codegraph', policy.codegraph.testedVersion);
    if (!existsSync(CODEGRAPH_DB)) throw new Error('CodeGraph is not initialized');
    const result = runTool('codegraph', ['sync'], { stdio: 'inherit' });
    if (result.status !== 0)
      throw new Error(`CodeGraph sync failed (exit ${result.status ?? 'null'})`);
    console.log('[graphs:update] codegraph: UPDATED (sync)');
  } catch (error) {
    console.error(`[graphs:update] codegraph: FAIL — ${error.message}`);
    failed = true;
  }
  process.exit(failed ? 1 : 0);
}

function report() {
  const policy = loadPolicy();
  try {
    requireToolVersion('graphify', policy.graphifyy.testedVersion);
    if (!existsSync(CODEGRAPH_DB)) throw new Error('CodeGraph is not initialized');
    requireToolVersion('codegraph', policy.codegraph.testedVersion);
    const syncResult = runTool('codegraph', ['sync'], { stdio: 'inherit' });
    if (syncResult.status !== 0) {
      throw new Error(`CodeGraph sync failed (exit ${syncResult.status ?? 'null'})`);
    }
    const graphifyResult = runNode('graphify-report.mjs', [], { stdio: 'inherit' });
    if (graphifyResult.status !== 0) throw new Error('Graphify report generation failed');
    const codegraphResult = runNode('codegraph-report.mjs', [], { stdio: 'inherit' });
    if (codegraphResult.status !== 0) throw new Error('CodeGraph report generation failed');
    if (!existsSync(GRAPHIFY_REPORT) || !existsSync(CODEGRAPH_REPORT)) {
      throw new Error('required report is absent after generation');
    }
    process.exit(0);
  } catch (error) {
    console.error(`[graphs:report] FAIL — ${error.message}`);
    process.exit(1);
  }
}

function refresh() {
  console.log(
    '[graphs:refresh] strict mode — synchronize once, report once, any failure is fatal.',
  );
  const reportResult = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'graphs-cli.mjs'), 'report'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  if (reportResult.status !== 0) {
    console.error('[graphs:refresh] FAIL — synchronized report stage failed.');
    process.exit(1);
  }
  const statusResult = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'graphs-cli.mjs'), 'status'],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (statusResult.status !== 0) {
    console.error('[graphs:refresh] FAIL — final freshness check failed.');
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

const commands = { bootstrap, doctor, status, update, report, refresh };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (!isSupportedCommand(command, commands)) {
    console.error(`Usage: node scripts/graphs-cli.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(1);
  }
  commands[command]();
}
