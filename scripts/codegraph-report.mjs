#!/usr/bin/env node
/**
 * Generates the compact, deterministic .codegraph/CODEGRAPH_REPORT.md from a real local index.
 * Fails loudly on any real failure — never embeds "Unavailable: <error>" into a file that still
 * looks like a successful report. Gated on a clean source tree (DIRTY_UNTRACKED_INPUT refuses to
 * write) so the embedded fingerprint always matches a committable state.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildMetadataBlock,
  checkCleanState,
  computeSourceFingerprint,
  ROOT,
} from './graphSourceFingerprint.mjs';

export const REPORT_PATH = join(ROOT, '.codegraph', 'CODEGRAPH_REPORT.md');
export const DB_PATH = join(ROOT, '.codegraph', 'codegraph.db');

export function resolveCodegraphCommand() {
  const fallback = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
  const prefix = spawnSync('npm', ['prefix', '-g'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (prefix.status !== 0 || prefix.error) return fallback;
  const globalBin =
    process.platform === 'win32' ? prefix.stdout.trim() : join(prefix.stdout.trim(), 'bin');
  const candidate = join(globalBin, process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph');
  return existsSync(candidate) ? candidate : fallback;
}

// QNBS-v3: sanitize every terminal control sequence before report content becomes committed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: defensive ANSI-escape strip, not user input
const ANSI_PATTERN = /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;

/** Redact an absolute machine path (repo root or home dir) to a repo-relative or generic form. */
export function redactPaths(
  text,
  { root = ROOT, home = process.env.HOME ?? process.env.USERPROFILE ?? '' } = {},
) {
  const replacePrefix = (input, target, replacement) => {
    if (!target) return input;
    const normalized = target.replace(/[\\/]$/, '');
    const variants = [
      ...new Set([normalized, normalized.replaceAll('/', '\\'), normalized.replaceAll('\\', '/')]),
    ];
    let output = input;
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = /^[A-Za-z]:[\\/]/.test(variant) ? 'gi' : 'g';
      output = output.replace(
        new RegExp(`(^|[^A-Za-z0-9._-])${escaped}(?=$|[\\\\/])`, flags),
        (_, prefix) => `${prefix}${replacement}`,
      );
    }
    return output;
  };
  return replacePrefix(replacePrefix(text, root, '.'), home, '~');
}

/** Strips ANSI escape codes, then redacts absolute paths — the full committed-report safety pass. */
export function sanitize(text, opts) {
  return redactPaths(text.replace(ANSI_PATTERN, ''), opts);
}

function runCodegraph(args) {
  const result = spawnSync(resolveCodegraphCommand(), [...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `codegraph ${args.join(' ')} failed (exit ${result.status ?? 'null'}): ${result.stderr ?? result.error?.message ?? ''}`,
    );
  }
  return result.stdout;
}

function readPolicy() {
  return JSON.parse(readFileSync(join(ROOT, 'config', 'graph-tools-versions.json'), 'utf-8'));
}

function exactVersion(output, expected) {
  return new RegExp(`(?:^|\\D)${expected.replaceAll('.', '\\.')}(?:$|\\D)`).test(output);
}

export function validateIndexStatus(status, expectedVersion) {
  const pending = status?.pendingChanges;
  const index = status?.index;
  if (status?.initialized !== true || !exactVersion(status.version ?? '', expectedVersion)) {
    throw new Error(`CodeGraph version/index mismatch; expected initialized ${expectedVersion}`);
  }
  if (
    !pending ||
    Object.values(pending).some((count) => typeof count !== 'number' || count !== 0) ||
    status.worktreeMismatch != null
  ) {
    throw new Error('CodeGraph index is stale: pending changes or worktree mismatch reported');
  }
  if (
    !index ||
    !exactVersion(index.builtWithVersion ?? '', expectedVersion) ||
    index.reindexRecommended !== false
  ) {
    throw new Error('CodeGraph index requires reindexing or was built with another version');
  }
  return status;
}

function parseStatus(output, expectedVersion) {
  try {
    return validateIndexStatus(JSON.parse(output), expectedVersion);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`could not parse codegraph status --json: ${error.message}`);
    throw error;
  }
}

function compactStatus(status) {
  return [
    `Initialized: ${status.initialized ? 'yes' : 'no'}`,
    `Version: ${status.version}`,
    `Files: ${status.fileCount}`,
    `Nodes: ${status.nodeCount}`,
    `Edges: ${status.edgeCount}`,
    `Pending changes: ${JSON.stringify(status.pendingChanges)}`,
    `Worktree mismatch: ${status.worktreeMismatch ?? 'none'}`,
    `Index built with: ${status.index.builtWithVersion}`,
    `Reindex required: ${status.index.reindexRecommended ? 'yes' : 'no'}`,
  ].join('\n');
}

function writeCandidate(report) {
  const candidate = `${REPORT_PATH}.tmp-${process.pid}`;
  writeFileSync(candidate, report);
  renameSync(candidate, REPORT_PATH);
}

export function generateReport() {
  if (!existsSync(DB_PATH)) {
    console.error(
      '[codegraph-report] SKIPPED_NOT_INITIALIZED — no local index. Run: pnpm run codegraph:update',
    );
    return 1;
  }

  const { clean, dirtyPaths } = checkCleanState();
  if (!clean) {
    console.error(
      `[codegraph-report] DIRTY_UNTRACKED_INPUT — refusing to write a committed report from an ` +
        `unstable source state. Commit or stash first:\n  ${dirtyPaths.join('\n  ')}`,
    );
    return 1;
  }

  const previousReport = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH) : null;
  let fingerprintBefore;
  try {
    fingerprintBefore = computeSourceFingerprint();
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const policy = readPolicy();
    const status = parseStatus(runCodegraph(['status', '--json']), policy.codegraph.testedVersion);
    const filesOutput = runCodegraph(['files', '--json']);
    let fileList;
    try {
      fileList = JSON.parse(filesOutput);
    } catch (error) {
      throw new Error(`could not parse codegraph files --json: ${error.message}`);
    }
    if (!Array.isArray(fileList) || fileList.some((file) => typeof file?.path !== 'string')) {
      throw new Error('codegraph files --json returned an invalid file list');
    }

    const fingerprintAfter = computeSourceFingerprint();
    const afterState = checkCleanState();
    if (!afterState.clean || fingerprintBefore !== fingerprintAfter) {
      throw new Error(
        'SOURCE_CHANGED_DURING_REPORT — source/index evidence is not one stable snapshot',
      );
    }
    const byExt = fileList.reduce((acc, file) => {
      const ext = file.path.split('.').pop() || 'none';
      acc[ext] = (acc[ext] || 0) + 1;
      return acc;
    }, {});
    const extLines = Object.entries(byExt)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([ext, count]) => `- **.${ext}**: ${count}`)
      .join('\n');
    const metadata = buildMetadataBlock({
      tool: 'codegraph',
      toolVersion: status.version,
      generationMode: 'local-index (codegraph status --json/files)',
      reportSchemaVersion: policy.reportSchemaVersion,
      fingerprint: fingerprintAfter,
    });
    const report = `# CodeGraph Report\n\n${metadata}\n\n## Status\n\n\`\`\`text\n${compactStatus(status)}\n\`\`\`\n\n## Files by Extension\n\n${extLines}\n\n---\n\n*Regenerate with: \`pnpm run graphs:report\` (or \`pnpm run codegraph:report\` directly). Freshness\ncheck: \`pnpm run graphs:status\`. Package: ${packageJson.name ?? 'worldscript-studio'}.*\n`;
    writeCandidate(report);
    if (!checkCleanState().clean || computeSourceFingerprint() !== fingerprintBefore) {
      throw new Error('SOURCE_CHANGED_DURING_REPORT — source changed before report commit');
    }
    console.log(`[codegraph-report] PASS — ${REPORT_PATH} generated.`);
    return 0;
  } catch (error) {
    if (previousReport === null) rmSync(REPORT_PATH, { force: true });
    else writeFileSync(REPORT_PATH, previousReport);
    console.error(`[codegraph-report] FAIL — ${error?.message ?? String(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(generateReport());
}
