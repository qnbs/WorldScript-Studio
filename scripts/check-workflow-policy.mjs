import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

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
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const label = relative(process.cwd(), file);
  if (/^\s*permissions:\s*write-all\s*$/m.test(content))
    failures.push(`${label}: write-all permissions`);
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*uses:\s*([^\s#]+)\s*$/);
    if (!match || match[1].startsWith('./') || match[1].startsWith('docker://')) continue;
    if (!/@[0-9a-f]{40}$/i.test(match[1])) failures.push(`${label}: unpinned action ${match[1]}`);
  }
}

const ciPath = join(workflowRoot, 'ci.yml');
const ci = readFileSync(ciPath, 'utf8');
for (const [name, pattern] of [
  ['required aggregate name', /name:\s*["']?✅ CI Success/],
  [
    'full cloud TypeScript authority',
    /tsgo\s+--project\s+tsconfig\.tsgo\.json\s+--noEmit\s+--checkers\s+4/,
  ],
  ['security dependency', /ci-success[\s\S]*needs:[\s\S]*security/],
  ['signature dependency', /ci-success[\s\S]*needs:[\s\S]*signatures/],
  ['quality dependency', /ci-success[\s\S]*needs:[\s\S]*quality/],
  ['build dependency', /ci-success[\s\S]*needs:[\s\S]*build/],
  ['E2E dependency', /ci-success[\s\S]*needs:[\s\S]*e2e/],
  ['Lighthouse dependency', /ci-success[\s\S]*needs:[\s\S]*lighthouse/],
  ['VRT dependency', /ci-success[\s\S]*needs:[\s\S]*vrt/],
]) {
  if (!pattern.test(ci)) failures.push(`.github/workflows/ci.yml: missing ${name}`);
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
  if (
    /contents:\s*write|softprops\/action-gh-release|(?:^|[|;&])\s*(?:cp|mv|rm|curl|wget)\b[^\n]*latest\.json/.test(
      intel,
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
