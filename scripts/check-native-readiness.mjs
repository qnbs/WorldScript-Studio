import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const roadmap = read('docs/native/ROADMAP-QT-GPUI-DESKTOP.md');
const earlyGates = read('docs/native/QT-EARLY-KILLER-GATES.md');
const adr0022 = read('docs/adr/0022-qt-pre-g2-qualification-harness.md');

const failures = [];
const requireText = (source, expected, message) => {
  const found = expected instanceof RegExp ? expected.test(source) : source.includes(expected);
  if (!found) failures.push(message);
};

const section = (source, heading, nextHeading) => {
  const start = source.indexOf(heading);
  const end = nextHeading ? source.indexOf(nextHeading, start + heading.length) : source.length;
  return start >= 0 && end >= start ? source.slice(start, end) : '';
};

const earlyLanes = section(roadmap, '## Early Native Feasibility Lanes', '## Wave 3');
const waveFive = section(roadmap, '## Wave 5 —', '## Wave 6 —');
const g1 = section(roadmap, '## G1 — Core Native-Ready', '## G2 —');
const earlyOrder = [
  'Lifecycle and bridge spike',
  'Accessibility and input feasibility',
  'Crash diagnostics and recovery feasibility',
];

// QNBS-v3: Keep cheap native-risk discovery and its maturity vocabulary mechanically ordered.
let previous = -1;
for (const lane of earlyOrder) {
  const current = earlyLanes.indexOf(lane);
  if (current <= previous) {
    failures.push(`Early native feasibility lane is missing or out of order: ${lane}`);
  }
  previous = current;
}

requireText(
  g1,
  '[x] native-readiness CI gate active — enforced by `pnpm run native-readiness:check`',
  'G1 must record the native-readiness policy gate and its executable command.',
);
requireText(
  roadmap,
  '[`docs/native/GPUI-EXPLORATIONS.md`](GPUI-EXPLORATIONS.md)',
  'The numbered roadmap must link the separate GPUI exploration record.',
);
requireText(
  roadmap,
  '## GPUI exploration boundary (not a numbered execution wave)',
  'GPUI must be explicitly outside the numbered execution roadmap.',
);
for (const wave of ['21', '22', '23', '24']) {
  if (new RegExp(`^## Wave ${wave} —`, 'm').test(roadmap)) {
    failures.push(`GPUI Wave ${wave} must not remain a numbered roadmap wave.`);
  }
}
requireText(
  earlyGates,
  'planned → locally proven → CI-proven → packaged-proven → admitted',
  'Qt qualification must retain the five-level maturity vocabulary.',
);
requireText(
  earlyGates,
  'The formal Wave 4.5 qualification consumes the early-lane evidence',
  'Wave 4.5 must consume early-lane evidence instead of silently duplicating it.',
);
requireText(
  waveFive,
  /does not repeat or\s+re-prove the early lifecycle, accessibility\/input, or crash gates/,
  'Wave 5 must state that it builds on, rather than duplicates, early qualification work.',
);
requireText(
  adr0022,
  'The early feasibility lanes are allowed before the formal Wave 4.5 checkpoint',
  'ADR-0022 must document the earlier bounded qualification lanes.',
);

if (failures.length > 0) {
  console.error('Native-readiness policy check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    'Native-readiness policy check passed: early lanes, maturity vocabulary, GPUI boundary, and Wave 5 sequencing are consistent.',
  );
}
