import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import {
  extractActionReferences,
  extractTopLevelJobName,
  hasAggregateResultAssertion,
  isReleasePublishingCommand,
  isSemanticallyUnconditionalIf,
} from './workflow-policy-guards.mjs';

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
      .some((line) => /^\s*permissions:\s*write-all\s*$/.test(stripWorkflowComment(line).trim()))
  )
    failures.push(`${label}: write-all permissions`);
  // QNBS-v3: inspect ordinary and flow-mapping action references for immutable pins.
  for (const rawLine of content.split('\n')) {
    const line = stripWorkflowComment(rawLine);
    for (const reference of extractActionReferences(line)) {
      if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
      if (!/@[0-9a-f]{40}$/i.test(reference))
        failures.push(`${label}: unpinned action ${reference}`);
    }
  }
}

const ciPath = join(workflowRoot, 'ci.yml');
const ci = readFileSync(ciPath, 'utf8');
// QNBS-v3: ignore YAML comments so disabled commands cannot satisfy cloud authority checks.
const executableCi = ci.split('\n').map(stripWorkflowComment).join('\n');
const ciLines = ci.split('\n');
const ciSuccessStart = ciLines.findIndex((line) => extractTopLevelJobName(line) === 'ci-success');
const nextJob = ciLines.findIndex(
  (line, index) => index > ciSuccessStart && extractTopLevelJobName(line) !== null,
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

function extractCiJobBlocks(content) {
  const lines = content.split('\n');
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const blocks = new Map();
  let currentName = '';
  if (jobsStart < 0) return blocks;
  for (const line of lines.slice(jobsStart + 1)) {
    const jobName = extractTopLevelJobName(line);
    if (jobName !== null) {
      currentName = jobName;
      blocks.set(currentName, []);
    } else if (currentName) {
      blocks.get(currentName).push(line);
    }
  }
  return new Map([...blocks].map(([name, linesForJob]) => [name, linesForJob.join('\n')]));
}

// QNBS-v3: require every unconditional CI job to have an explicit required or advisory disposition.
const ciJobBlocks = extractCiJobBlocks(ci);
for (const [jobName, block] of ciJobBlocks) {
  if (jobName === 'ci-success') continue;
  const executableBlock = block.split('\n').map(stripWorkflowComment).join('\n');
  const conditional = /^ {4}if:\s*/m.test(executableBlock) && !isSemanticallyUnconditionalIf(block);
  const advisory = /^ {4}continue-on-error:\s*true\s*$/m.test(executableBlock);
  if (!conditional && !ciNeeds.includes(jobName) && !advisory)
    failures.push(
      `.github/workflows/ci.yml: unconditional job ${jobName} lacks required/advisory disposition`,
    );
}

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
  // QNBS-v3: scan complete normalized workflow commands for release mutation paths.
  const executableIntelLines = intel
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#.*$/, '')
        .replace(/\s+#.*$/, '')
        .trim(),
    )
    .filter(Boolean);
  const executableIntelSource = intel
    .split('\n')
    .map((line) => line.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, ''))
    .join('\n');
  if (
    executableIntelLines.some(
      (line) =>
        /contents:\s*write|softprops\/action-gh-release/.test(line) ||
        /\blatest\.json\b/.test(line) ||
        isReleasePublishingCommand(executableIntelSource),
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
