#!/usr/bin/env node
/**
 * Regenerates graphify-out/GRAPH_REPORT.md as a compact, bounded, deterministic public report.
 *
 * Graphify's own `graphify update .` writes a native GRAPH_REPORT.md directly (not something this
 * repo authors from scratch) — but on a corpus this size that native report lists every single
 * community in full (thousands of lines), which is too large and noisy to keep committed. This
 * script runs the native update, then post-processes its output: keeps the small architecture-level
 * sections as-is, truncates the community list to the top N by node count, and prepends this repo's
 * own fingerprint-based freshness metadata (authoritative — graphify's own "Built from commit" line
 * is informational only, see `graphs:status`). Full untruncated data stays local in
 * graphify-out/graph.json / graph.html (gitignored) — rebuild anytime with `pnpm run graphify:update`.
 *
 * Fails loudly on any real failure. Gated on a clean source tree (DIRTY_UNTRACKED_INPUT refuses to
 * write) so the embedded fingerprint always matches a committable state.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitize } from './codegraph-report.mjs';
import {
  buildMetadataBlock,
  checkCleanState,
  computeSourceFingerprint,
  ROOT,
} from './graphSourceFingerprint.mjs';

const REPORT_PATH = join(ROOT, 'graphify-out', 'GRAPH_REPORT.md');
const PREVIOUS_COMPACT_BACKUP = `${REPORT_PATH}.previous-compact`;
const TOP_N_COMMUNITIES = 20;

function loadPolicy() {
  return JSON.parse(readFileSync(join(ROOT, 'config', 'graph-tools-versions.json'), 'utf-8'));
}

function hasExactVersion(output, version) {
  return new RegExp(`(?:^|\\D)${version.replaceAll('.', '\\.')}(?:$|\\D)`).test(output);
}

function runGraphify(args, options = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'graphify-cli.mjs'), ...args], {
    cwd: ROOT,
    env: process.env,
    ...options,
  });
}

function restorePreviousReport(hasBackup) {
  rmSync(REPORT_PATH, { force: true });
  if (hasBackup && existsSync(PREVIOUS_COMPACT_BACKUP)) {
    renameSync(PREVIOUS_COMPACT_BACKUP, REPORT_PATH);
  }
}

function parseProjectName() {
  try {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    return packageJson.name ?? 'project';
  } catch (error) {
    throw new Error(`could not parse package.json: ${error?.message ?? String(error)}`);
  }
}

function reuseTopology(previous, titleLine, metadata) {
  const generationMarker = previous.indexOf('Generation mode:');
  const bodyStart = previous.indexOf('\n\n', generationMarker);
  if (!previous.startsWith('# Graph Report - ') || generationMarker < 0 || bodyStart < 0) {
    throw new Error('previous compact report has invalid metadata and cannot be reused');
  }
  return `${titleLine}\n\n${metadata}${previous.slice(bodyStart)}`;
}

function writeCandidate(report) {
  const candidate = `${REPORT_PATH}.tmp-${process.pid}`;
  writeFileSync(candidate, report);
  renameSync(candidate, REPORT_PATH);
}

export function generateReport() {
  let policy;
  try {
    policy = loadPolicy();
  } catch (error) {
    console.error(
      `[graphify-report] FAIL — could not parse graph-tools-versions.json: ${error.message}`,
    );
    return 1;
  }
  const expectedVersion = policy.graphifyy.testedVersion;
  const initialState = checkCleanState();
  if (!initialState.clean) {
    console.error(
      `[graphify-report] DIRTY_UNTRACKED_INPUT — refusing to write a committed report from an ` +
        `unstable source state. Commit or stash first:\n  ${initialState.dirtyPaths.join('\n  ')}`,
    );
    return 1;
  }

  let fingerprintBefore;
  try {
    fingerprintBefore = computeSourceFingerprint();
  } catch (error) {
    console.error(`[graphify-report] FAIL — ${error.message}`);
    return 1;
  }

  let projectName;
  try {
    projectName = parseProjectName();
  } catch (error) {
    console.error(`[graphify-report] FAIL — ${error.message}`);
    return 1;
  }
  const titleLine = `# Graph Report - ${projectName}`;
  const hadBackup = existsSync(REPORT_PATH);
  // QNBS-v3: retain the prior compact report until every generation and stability check succeeds.
  rmSync(PREVIOUS_COMPACT_BACKUP, { force: true });
  if (hadBackup) renameSync(REPORT_PATH, PREVIOUS_COMPACT_BACKUP);

  try {
    if (process.env.GRAPHIFY_SKIP === '1') {
      throw new Error('GRAPHIFY_SKIP=1 is not valid for strict report generation');
    }
    const updateResult = runGraphify(['update', '.'], { stdio: 'inherit' });
    if (updateResult.status !== 0) {
      throw new Error('graphify update did not complete successfully');
    }

    const versionResult = runGraphify(['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const versionOutput = `${versionResult.stdout ?? ''}\n${versionResult.stderr ?? ''}`;
    if (versionResult.status !== 0 || !hasExactVersion(versionOutput, expectedVersion)) {
      throw new Error(
        `Graphify version mismatch: expected ${expectedVersion}, got ${versionOutput.trim() || '(no output)'}`,
      );
    }

    if (computeSourceFingerprint() !== fingerprintBefore || !checkCleanState().clean) {
      throw new Error('SOURCE_CHANGED_DURING_REPORT — source changed during Graphify generation');
    }

    let native;
    if (existsSync(REPORT_PATH)) {
      native = sanitize(readFileSync(REPORT_PATH, 'utf-8'));
    } else if (hadBackup) {
      const metadata = buildMetadataBlock({
        tool: 'graphify',
        toolVersion: expectedVersion,
        generationMode: 'AST-only local build (graphify update .)',
        reportSchemaVersion: policy.reportSchemaVersion,
        fingerprint: fingerprintBefore,
      });
      native = reuseTopology(readFileSync(PREVIOUS_COMPACT_BACKUP, 'utf-8'), titleLine, metadata);
      writeCandidate(native);
      if (computeSourceFingerprint() !== fingerprintBefore || !checkCleanState().clean) {
        throw new Error('SOURCE_CHANGED_DURING_REPORT — source changed before metadata refresh');
      }
      rmSync(PREVIOUS_COMPACT_BACKUP, { force: true });
      console.log(
        '[graphify-report] PASS — no topology change; compact report metadata refreshed.',
      );
      return 0;
    } else {
      throw new Error('graphify wrote no native report and no previous compact report exists');
    }

    const sections = splitSections(native);
    const KEEP_AS_IS = [
      'Corpus Check',
      'Summary',
      'God Nodes',
      'Surprising Connections',
      'Import Cycles',
      'Knowledge Gaps',
      'Suggested Questions',
    ];
    const communitiesSection = findSection(sections, 'Communities (');
    let compactCommunitiesBlock = '';
    let totalCommunities = 0;
    let keptCommunities = 0;
    if (communitiesSection) {
      const totalMatch = communitiesSection.heading.match(/\((\d+) total/);
      totalCommunities = totalMatch ? Number(totalMatch[1]) : 0;
      const blocks = communitiesSection.body
        .join('\n')
        .split(/(?=^### )/m)
        .map((block) => block.trim())
        .filter(Boolean);
      const ranked = blocks
        .map((block) => {
          const nodeCountMatch = block.match(/Nodes \((\d+)\):/);
          return { block, nodeCount: nodeCountMatch ? Number(nodeCountMatch[1]) : 0 };
        })
        .sort((a, b) => b.nodeCount - a.nodeCount);
      const top = ranked.slice(0, TOP_N_COMMUNITIES);
      keptCommunities = top.length;
      compactCommunitiesBlock = top.map((community) => community.block).join('\n\n');
    }
    const omittedCount = Math.max(0, totalCommunities - keptCommunities);
    const communitiesHeading = `## Top ${keptCommunities} Communities by size (of ${totalCommunities} total)`;
    const communitiesNote =
      omittedCount > 0
        ? `\n\n_${omittedCount} smaller communities omitted from this committed summary — full detail in local graphify-out/graph.json / graph.html (gitignored, not committed). Rebuild anytime: \`pnpm run graphify:update\`._`
        : '';
    const metadata = buildMetadataBlock({
      tool: 'graphify',
      toolVersion: expectedVersion,
      generationMode: 'AST-only local build (graphify update .)',
      reportSchemaVersion: policy.reportSchemaVersion,
      fingerprint: fingerprintBefore,
    });
    const keptSectionsMarkdown = KEEP_AS_IS.map((heading) => {
      const section = findSection(sections, heading);
      return section ? `## ${section.heading}\n${section.body.join('\n').trim()}` : null;
    })
      .filter(Boolean)
      .join('\n\n');
    const report = `${titleLine}\n\n${metadata}\n\n${keptSectionsMarkdown}\n\n${communitiesHeading}${communitiesNote}\n\n${compactCommunitiesBlock}\n`;
    writeCandidate(report);
    if (computeSourceFingerprint() !== fingerprintBefore || !checkCleanState().clean) {
      throw new Error('SOURCE_CHANGED_DURING_REPORT — source changed before report commit');
    }
    rmSync(PREVIOUS_COMPACT_BACKUP, { force: true });
    console.log(
      `[graphify-report] PASS — ${REPORT_PATH} generated (${keptCommunities}/${totalCommunities} communities kept).`,
    );
    return 0;
  } catch (error) {
    restorePreviousReport(hadBackup);
    console.error(`[graphify-report] FAIL — ${error?.message ?? String(error)}`);
    return 1;
  }
}

/** Split the native report into ordered sections keyed by their `## Heading` line. */
function splitSections(markdown) {
  const lines = markdown.split('\n');
  /** @type {{heading: string, body: string[]}[]} */
  const sections = [{ heading: '__preamble__', body: [] }];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }
  return sections;
}

function findSection(sections, headingPrefix) {
  return sections.find((s) => s.heading.startsWith(headingPrefix));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(generateReport());
}
