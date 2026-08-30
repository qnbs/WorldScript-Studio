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
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeCodegraph } from './codegraph-report.mjs';
import { runGraphifyCommand } from './graphify-bootstrap.mjs';
import { recoverOrphanedCompactReport } from './graphify-report.mjs';
import {
  checkCleanState,
  computeSourceFingerprint,
  matchesExactVersion,
  ROOT,
} from './graphSourceFingerprint.mjs';

const POLICY_PATH = join(ROOT, 'config', 'graph-tools-versions.json');
const GRAPHIFY_OUTPUT_DIR = join(ROOT, 'graphify-out');
const GRAPHIFY_REPORT = join(ROOT, 'graphify-out', 'GRAPH_REPORT.md');
const GRAPHIFY_REPORT_BACKUP = `${GRAPHIFY_REPORT}.previous-compact`;
const CODEGRAPH_REPORT = join(ROOT, '.codegraph', 'CODEGRAPH_REPORT.md');
const CODEGRAPH_DB = join(ROOT, '.codegraph', 'codegraph.db');
const GRAPHIFY_EPHEMERAL_OUTPUTS = [
  'manifest.json',
  'cost.json',
  'transcripts',
  'wiki',
  'obsidian',
];

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

export function shouldSkipGraphifyUpdate(args, env = process.env) {
  return args[0] === 'update' && env.GRAPHIFY_SKIP === '1';
}

// QNBS-v3: keep the routed dual-graph update from retaining stale Graphify sidecars.
export function cleanupGraphifyEphemeralOutputs(outputDir = GRAPHIFY_OUTPUT_DIR) {
  for (const name of GRAPHIFY_EPHEMERAL_OUTPUTS) {
    rmSync(join(outputDir, name), { recursive: true, force: true });
  }
}

function runTool(command, args, options = {}) {
  if (command === 'codegraph') return executeCodegraph(args, options);
  if (command === 'graphify') return runGraphifyCommand(args, options);
  return spawnSync(command, args, { cwd: ROOT, env: process.env, ...options });
}

export function versionProbeStatus(result) {
  if (result.error?.code === 'ENOENT') return 'SKIPPED_NOT_INSTALLED';
  if (result.error || result.status == null || result.status !== 0) return 'FAIL';
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() ? 'AVAILABLE' : 'FAIL';
}

function commandVersion(cmd, args = ['--version']) {
  const result = runTool(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    status: versionProbeStatus(result),
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() || null,
    exitCode: result.status,
  };
}

function requireToolVersion(command, expected) {
  const probe = commandVersion(command);
  if (probe.status === 'SKIPPED_NOT_INSTALLED') throw new Error(`${command} is not available`);
  if (probe.status === 'FAIL') {
    throw new Error(`${command} version probe failed (exit ${probe.exitCode ?? 'null'})`);
  }
  if (!matchesExactVersion(probe.output, expected)) {
    throw new Error(`${command} version mismatch: expected ${expected}, got ${probe.output}`);
  }
  return probe.output;
}

export function prepareGraphifyReportBackup(
  reportPath = GRAPHIFY_REPORT,
  backupPath = GRAPHIFY_REPORT_BACKUP,
) {
  recoverOrphanedCompactReport(reportPath, backupPath);
  // QNBS-v3: runtime-only updates preserve report bytes even when the prior report is invalid.
  const hadReport = existsSync(reportPath);
  if (existsSync(backupPath)) {
    // The recovery helper has validated this backup; replacing it is safe only after validation.
    rmSync(backupPath);
  }
  if (hadReport) renameSync(reportPath, backupPath);
  return hadReport;
}

export function restoreGraphifyReportBackup(
  hadReport,
  reportPath = GRAPHIFY_REPORT,
  backupPath = GRAPHIFY_REPORT_BACKUP,
) {
  rmSync(reportPath, { force: true });
  if (hadReport) {
    if (!existsSync(backupPath)) {
      throw new Error('recoverable compact Graphify report backup is missing');
    }
    renameSync(backupPath, reportPath);
  }
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
      /^## Top \d+ Communities by size \(of \d+ total\)$/m.test(text)
    );
  }
  if (tool === 'codegraph') {
    const statusMatch = text.match(
      /^# CodeGraph Report\n\n[\s\S]*?\n\n## Status\n\n```text\nInitialized: yes\nVersion: \S+\nFiles: (\d+)\nNodes: \d+\nEdges: \d+\nPending changes: \{"added":0,"modified":0,"removed":0\}\nWorktree mismatch: (?:none|\S+)\nIndex built with: \S+\nReindex required: no\n```\n\n## Files by Extension\n\n([\s\S]*?)\n\n---\n\n\*Regenerate with: `pnpm run graphs:report`[\s\S]*$/,
    );
    if (!statusMatch) return false;

    const fileCount = Number(statusMatch[1]);
    const extensionLines = statusMatch[2].trim() ? statusMatch[2].trim().split('\n') : [];
    const extensionCounts = extensionLines.map((line) => {
      const match = line.match(
        /^- \*\*\.(?:[\p{L}\p{N}_$@%/,=?^ ]|\\[\\`*_{}[\]()#+.!|>~-])+\*\*: (\d+)$/u,
      );
      if (!match) return null;
      return Number(match[1]);
    });
    return (
      extensionLines.length === extensionCounts.length &&
      extensionCounts.every((count) => count != null && count > 0) &&
      extensionCounts.reduce((total, count) => total + count, 0) === fileCount
    );
  }
  return false;
}

// QNBS-v3: classify reports from schema, exact tool version, and current source fingerprint.
export function reportFreshness(meta, options, fingerprint) {
  const { reportSchemaVersion: schema, expectedVersion: version, expectedTool: tool } = options;
  if (!meta.exists) return 'MISSING';
  if (meta.schema !== String(schema) || meta.toolVersion !== version) return 'VERSION_MISMATCH';
  if (meta.fingerprint !== fingerprint) return 'STALE';
  if (meta.tool !== tool) return 'REPORT_INVALID';
  return validateReportStructure(meta.text, tool) ? 'FRESH' : 'REPORT_INVALID';
}

function doctor() {
  const policy = loadPolicy();
  const graphifyVersion = commandVersion('graphify');
  const codegraphVersion = commandVersion('codegraph');
  const codegraphInitialized = existsSync(CODEGRAPH_DB);

  const versionLabel = (probe) => {
    if (probe.status === 'SKIPPED_NOT_INSTALLED') return 'SKIPPED_NOT_INSTALLED';
    if (probe.status === 'FAIL') return `FAIL (version probe exit ${probe.exitCode ?? 'null'})`;
    return `installed ${probe.output}`;
  };

  console.log('=== graphs:doctor ===');
  console.log(
    `graphifyy: ${versionLabel(graphifyVersion)} ` +
      `(policy: ${policy.graphifyy.testedVersion}, ${policy.graphifyy.policy})`,
  );
  if (
    graphifyVersion.status === 'AVAILABLE' &&
    !matchesExactVersion(graphifyVersion.output, policy.graphifyy.testedVersion)
  ) {
    console.log('  -> VERSION_MISMATCH (run `pnpm run graphify:bootstrap` to align)');
  }
  console.log(
    `@colbymchenry/codegraph: ${versionLabel(codegraphVersion)} ` +
      `(policy: ${policy.codegraph.testedVersion}, ${policy.codegraph.policy})`,
  );
  if (
    codegraphVersion.status === 'AVAILABLE' &&
    !matchesExactVersion(codegraphVersion.output, policy.codegraph.testedVersion)
  ) {
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
            `freshness=${currentFingerprint ? reportFreshness(meta, { reportSchemaVersion: policy.reportSchemaVersion, expectedVersion: label.startsWith('Graphify') ? policy.graphifyy.testedVersion : policy.codegraph.testedVersion, expectedTool: label.startsWith('Graphify') ? 'graphify' : 'codegraph' }, currentFingerprint) : 'UNAVAILABLE'}`
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
    const expectedVersion = (label[0] === 'g' ? policy.graphifyy : policy.codegraph).testedVersion;
    const freshness = reportFreshness(
      meta,
      { ...policy, expectedVersion, expectedTool: label[0] === 'g' ? 'graphify' : 'codegraph' },
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
    cleanupGraphifyEphemeralOutputs();
    const hadPreviousReport = prepareGraphifyReportBackup();
    try {
      const graphifyResult = runTool('graphify', ['update', '.'], { stdio: 'inherit' });
      if (graphifyResult.status !== 0) throw new Error('Graphify update failed');
      restoreGraphifyReportBackup(hadPreviousReport);
    } catch (error) {
      restoreGraphifyReportBackup(hadPreviousReport);
      throw error;
    } finally {
      cleanupGraphifyEphemeralOutputs();
    }
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

function graphify(args) {
  if (shouldSkipGraphifyUpdate(args)) {
    console.log('[graphs:graphify] Skipped (GRAPHIFY_SKIP=1).');
    process.exit(0);
  }
  const result = runTool('graphify', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

// QNBS-v3: route direct CodeGraph scripts through the verified resolver on every platform.
function codegraph(args) {
  const result = executeCodegraph(args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const commands = { bootstrap, doctor, status, update, report, refresh, codegraph, graphify };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (!isSupportedCommand(command, commands)) {
    console.error(`Usage: node scripts/graphs-cli.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(1);
  }
  if (command === 'codegraph' || command === 'graphify') commands[command](process.argv.slice(3));
  else commands[command]();
}
