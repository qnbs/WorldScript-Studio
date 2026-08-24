import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { isReleasePublishingCommand } from './workflow-policy-guards.mjs';

const root = join(process.cwd(), '.github');
const workflowRoot = join(root, 'workflows');
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collect(path);
    else if (/\.(?:yml|yaml)$/.test(entry)) files.push(path);
  }
}

collect(root);
// QNBS-v3: keep workflow governance checks offline and narrow so CI remains the authoritative execution gate.
const failures = [];
function stripWorkflowComment(line) {
  return line.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '');
}

function hasReadOnlyTopLevelPermissions(content) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => /^permissions:\s*/.test(line));
  if (index < 0) return false;
  const inline = lines[index]
    .replace(/\s+#.*$/, '')
    .replace(/^permissions:\s*/, '')
    .trim();
  if (inline) return inline === '{ contents: read }';
  const block = [];
  for (const line of lines.slice(index + 1)) {
    const uncommented = line.replace(/\s+#.*$/, '').trimEnd();
    if (uncommented && !/^\s{2}/.test(uncommented)) break;
    if (uncommented.trim()) block.push(uncommented.trim());
  }
  return block.length === 1 && /^contents:\s*read$/.test(block[0]);
}

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const label = relative(process.cwd(), file);
  if (file.startsWith(workflowRoot) && !hasReadOnlyTopLevelPermissions(content))
    failures.push(`${label}: top-level permissions must include contents: read`);
  if (
    content
      .split('\n')
      .some((line) => /^\s*permissions:\s*write-all\s*$/.test(line.replace(/\s+#.*$/, '')))
  )
    failures.push(`${label}: write-all permissions`);
  for (const line of content.split('\n')) {
    const match = line.replace(/\s+#.*$/, '').match(/^\s*(?:-\s*)?uses:\s*(\S+)\s*$/);
    if (!match || match[1].startsWith('./') || match[1].startsWith('docker://')) continue;
    if (!/@[0-9a-f]{40}$/i.test(match[1])) failures.push(`${label}: unpinned action ${match[1]}`);
  }
}

const ciPath = join(workflowRoot, 'ci.yml');
const ci = readFileSync(ciPath, 'utf8');
const executableCi = ci.split('\n').map(stripWorkflowComment).join('\n');
const ciLines = ci.split('\n');
const ciSuccessStart = ciLines.findIndex((line) => /^\s{2}ci-success:\s*$/.test(line));
const nextJob = ciLines.findIndex(
  (line, index) => index > ciSuccessStart && /^\s{2}[A-Za-z0-9_-]+:\s*$/.test(line),
);
const ciSuccessBlock =
  ciSuccessStart >= 0
    ? ciLines
        .slice(ciSuccessStart, nextJob >= 0 ? nextJob : undefined)
        .map(stripWorkflowComment)
        .join('\n')
    : '';
const ciNeedsMatch = ciSuccessBlock.match(/^\s+needs:\s*(.+)$/m);
const ciNeeds = ciNeedsMatch
  ? [...ciNeedsMatch[1].matchAll(/[A-Za-z0-9_-]+/g)].map(([value]) => value)
  : [];
const requiredAggregateJobs = [
  'security',
  'signatures',
  'quality',
  'changes',
  'rust-tauri',
  'core-rust',
  'build',
  'e2e',
  'lighthouse',
  'vrt',
];
for (const [name, pattern] of [
  ['required aggregate name', /name:\s*["']?✅ CI Success/],
  [
    'full cloud TypeScript authority',
    /tsgo\s+--project\s+tsconfig\.tsgo\.json\s+--noEmit\s+--checkers\s+4/,
  ],
]) {
  if (!pattern.test(executableCi)) failures.push(`.github/workflows/ci.yml: missing ${name}`);
}

function hasAggregateResultAssertion(block, dependency, allowsSkipped) {
  const lines = block.split('\n').filter((line) => line.includes(`needs.${dependency}.result`));
  if (allowsSkipped) {
    return (
      lines.some((line) => /!=\s*['"]success['"]/.test(line)) &&
      lines.some((line) => /!=\s*['"]skipped['"]/.test(line))
    );
  }
  return lines.some((line) => /\s=\s*['"]success['"]/.test(line));
}

for (const dependency of requiredAggregateJobs) {
  if (!ciNeeds.includes(dependency))
    failures.push(`.github/workflows/ci.yml: ci-success missing ${dependency} dependency`);
  if (
    !hasAggregateResultAssertion(
      ciSuccessBlock,
      dependency,
      ['rust-tauri', 'core-rust'].includes(dependency),
    )
  )
    failures.push(`.github/workflows/ci.yml: ci-success does not assert ${dependency} result`);
}

const intelPath = join(workflowRoot, 'tauri-intel-qualification.yml');
if (files.includes(intelPath)) {
  const intel = readFileSync(intelPath, 'utf8');
  for (const [name, pattern] of [
    ['workflow dispatch', /workflow_dispatch:/],
    ['primary Intel runner', /macos-15-intel/],
    ['advisory Intel runner', /macos-26-intel/],
  ]) {
    if (!pattern.test(intel))
      failures.push(`${relative(process.cwd(), intelPath)}: missing ${name}`);
  }
  const executableIntelLines = intel
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#.*$/, '')
        .replace(/\s+#.*$/, '')
        .trim(),
    )
    .filter(Boolean);
  if (
    executableIntelLines.some(
      (line) =>
        /contents:\s*write|softprops\/action-gh-release/.test(line) ||
        /\blatest\.json\b/.test(line) ||
        isReleasePublishingCommand(executableIntelLines.join('\n')),
    )
  ) {
    failures.push(
      `${relative(process.cwd(), intelPath)}: qualification workflow may publish release state`,
    );
  }
}

if (failures.length > 0) {
  console.error('[workflow-policy] FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`[workflow-policy] PASS (${files.length} workflow/action files checked)`);
