#!/usr/bin/env node
/**
 * Generates the compact, deterministic .codegraph/CODEGRAPH_REPORT.md from a real local index.
 * Fails loudly on any real failure — never embeds "Unavailable: <error>" into a file that still
 * looks like a successful report. Gated on a clean source tree (DIRTY_UNTRACKED_INPUT refuses to
 * write) so the embedded fingerprint always matches a committable state.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMetadataBlock, checkCleanState, ROOT } from './graphSourceFingerprint.mjs';

export const REPORT_PATH = join(ROOT, '.codegraph', 'CODEGRAPH_REPORT.md');
export const DB_PATH = join(ROOT, '.codegraph', 'codegraph.db');

// biome-ignore lint/suspicious/noControlCharactersInRegex: defensive ANSI-escape strip, not user input
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Redact an absolute machine path (repo root or home dir) to a repo-relative or generic form. */
export function redactPaths(
  text,
  { root = ROOT, home = process.env.HOME ?? process.env.USERPROFILE ?? '' } = {},
) {
  let redacted = root ? text.split(root).join('.') : text;
  if (home) redacted = redacted.split(home).join('~');
  return redacted;
}

/** Strips ANSI escape codes, then redacts absolute paths — the full committed-report safety pass. */
export function sanitize(text, opts) {
  return redactPaths(text.replace(ANSI_PATTERN, ''), opts);
}

function runCodegraph(args) {
  const result = spawnSync('codegraph', [...args, '--no-color'], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`codegraph ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
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

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const versionResult = spawnSync('codegraph', ['--version'], { encoding: 'utf-8' });
  const toolVersion = (versionResult.stdout ?? '').trim() || 'unknown';

  let statusOutput;
  let filesOutput;
  try {
    statusOutput = sanitize(runCodegraph(['status']));
    filesOutput = runCodegraph(['files', '--json']);
  } catch (error) {
    console.error(`[codegraph-report] FAIL — ${error.message}`);
    return 1;
  }

  let fileList;
  try {
    fileList = JSON.parse(filesOutput);
  } catch (error) {
    console.error(
      `[codegraph-report] FAIL — could not parse \`codegraph files --json\`: ${error.message}`,
    );
    return 1;
  }

  const byExt = fileList.reduce((acc, f) => {
    const ext = f.path.split('.').pop() || 'none';
    acc[ext] = (acc[ext] || 0) + 1;
    return acc;
  }, {});

  const extLines = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `- **.${ext}**: ${count}`)
    .join('\n');

  const metadata = buildMetadataBlock({
    tool: 'codegraph',
    toolVersion,
    generationMode: 'local-index (codegraph status/files)',
    reportSchemaVersion: 1,
  });

  const report = `# CodeGraph Report

${metadata}

## Status

\`\`\`
${statusOutput.trim()}
\`\`\`

## Files by Extension

${extLines}

---

*Regenerate with: \`pnpm run graphs:report\` (or \`pnpm run codegraph:report\` directly). Freshness
check: \`pnpm run graphs:status\`. Package: ${packageJson.name ?? 'worldscript-studio'}.*
`;

  writeFileSync(REPORT_PATH, report);
  console.log(`[codegraph-report] PASS — ${REPORT_PATH} generated.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(generateReport());
}
