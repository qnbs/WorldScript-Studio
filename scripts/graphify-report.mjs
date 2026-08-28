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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMetadataBlock, checkCleanState, ROOT } from './graphSourceFingerprint.mjs';

const REPORT_PATH = join(ROOT, 'graphify-out', 'GRAPH_REPORT.md');
const TOP_N_COMMUNITIES = 20;

const { clean, dirtyPaths } = checkCleanState();
if (!clean) {
  console.error(
    `[graphify-report] DIRTY_UNTRACKED_INPUT — refusing to write a committed report from an ` +
      `unstable source state. Commit or stash first:\n  ${dirtyPaths.join('\n  ')}`,
  );
  process.exit(1);
}

const updateResult = spawnSync(process.execPath, [join(ROOT, 'scripts', 'graphify-update.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});
if (updateResult.status !== 0) {
  console.error('[graphify-report] FAIL — graphify update did not complete successfully.');
  process.exit(updateResult.status ?? 1);
}

const versionResult = spawnSync('graphify', ['--version'], { encoding: 'utf-8' });
const toolVersion = (versionResult.stdout ?? '').trim() || 'unknown';

let native;
try {
  native = readFileSync(REPORT_PATH, 'utf-8');
} catch (error) {
  console.error(`[graphify-report] FAIL — could not read native report: ${error.message}`);
  process.exit(1);
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
    .map((b) => b.trim())
    .filter(Boolean);

  const ranked = blocks
    .map((block) => {
      const nodeCountMatch = block.match(/Nodes \((\d+)\):/);
      return { block, nodeCount: nodeCountMatch ? Number(nodeCountMatch[1]) : 0 };
    })
    .sort((a, b) => b.nodeCount - a.nodeCount);

  const top = ranked.slice(0, TOP_N_COMMUNITIES);
  keptCommunities = top.length;
  compactCommunitiesBlock = top.map((c) => c.block).join('\n\n');
}

const omittedCount = Math.max(0, totalCommunities - keptCommunities);
const communitiesHeading = `## Top ${keptCommunities} Communities by size (of ${totalCommunities} total)`;
const communitiesNote =
  omittedCount > 0
    ? `\n\n_${omittedCount} smaller communities omitted from this committed summary — full detail in local graphify-out/graph.json / graph.html (gitignored, not committed). Rebuild anytime: \`pnpm run graphify:update\`._`
    : '';

const metadata = buildMetadataBlock({
  tool: 'graphifyy',
  toolVersion,
  generationMode: 'AST-only local build (graphify update .)',
  reportSchemaVersion: 1,
});

// Graphify infers the project name from the cwd basename, which is "main" inside this repo's
// worktree layout (.worktrees/main) — use package.json's real name instead, and strip the
// embedded build date so the title doesn't break determinism across day boundaries.
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const projectName = packageJson.name ?? 'project';
const titleLine = `# Graph Report - ${projectName}`;

const keptSectionsMarkdown = KEEP_AS_IS.map((heading) => {
  const section = findSection(sections, heading);
  if (!section) return null;
  return `## ${section.heading}\n${section.body.join('\n').trim()}`;
})
  .filter(Boolean)
  .join('\n\n');

const report = `${titleLine}

${metadata}

${keptSectionsMarkdown}

${communitiesHeading}${communitiesNote}

${compactCommunitiesBlock}
`;

writeFileSync(REPORT_PATH, report);
console.log(
  `[graphify-report] PASS — ${REPORT_PATH} generated (${keptCommunities}/${totalCommunities} communities kept).`,
);
