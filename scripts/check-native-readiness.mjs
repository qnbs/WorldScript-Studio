import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const roadmap = read('docs/native/ROADMAP-QT-GPUI-DESKTOP.md');
const roadmapRev3 = read('docs/native/DESKTOP-MIGRATION-ROADMAP-REV3.md');
const tauriPolicy = read('docs/native/TAURI-TRANSITIONAL-MAINTENANCE.md');
const reusePolicy = read('docs/architecture/ARCHITECTURE-REUSE-OWNERSHIP.md');
const earlyGates = read('docs/native/QT-EARLY-KILLER-GATES.md');
const adr0022 = read('docs/adr/0022-qt-pre-g2-qualification-harness.md');
const nativeReadiness = read('docs/architecture/native-readiness.md');

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
const rev3G15 = section(
  roadmapRev3,
  '### G1.5 — Tauri Evidence Exit / Qt Transfer Readiness — NEW',
  '### G2 — Qt Implementation Admission',
);
const rev3G25 = section(
  roadmapRev3,
  '### G2.5 — Qt Renderer Differential Gate — NEW',
  '### G3 — Qt Beta',
);
const rev3Wave25 = section(
  roadmapRev3,
  '### Wave 2.5 — Desktop differential baseline & #332 classification — NEW',
  '### Wave 3 — Storage correctness and R-15 design',
);
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

// QNBS-v3: Validate mandatory Revision-3 gates inside their real sections so summary bullets cannot mask deleted gate bodies.
requireText(
  rev3G15,
  'GOLDEN-DESKTOP-LIFECYCLE-332 encoded as reusable evidence specification',
  'Revision 3 G1.5 must retain the reusable #332 lifecycle evidence requirement.',
);
requireText(
  rev3G15,
  'PWA/Tauri baseline measurements captured on representative target hardware',
  'Revision 3 G1.5 must retain representative PWA/Tauri baseline evidence.',
);
requireText(
  rev3G25,
  'capture Qt Quick graphics backend',
  'Revision 3 G2.5 must retain Qt graphics-backend evidence.',
);
requireText(
  rev3G25,
  'run 20-cycle Alt-Tab scenario',
  'Revision 3 G2.5 must retain the Alt-Tab differential scenario.',
);
requireText(
  rev3Wave25,
  'portable-memory classification',
  'Revision 3 Wave 2.5 must retain portable-memory classification.',
);
requireText(
  rev3Wave25,
  'Tauri stop-rule decision record',
  'Revision 3 Wave 2.5 must retain the Tauri stop-rule decision record.',
);
requireText(
  roadmapRev3,
  'GOLDEN-DESKTOP-LIFECYCLE-332',
  'Revision 3 must retain the cross-renderer #332 lifecycle acceptance scenario.',
);
requireText(
  tauriPolicy,
  'DESKTOP-MIGRATION-ROADMAP-REV3.md` is the **normative Revision-3 amendment**',
  'The Tauri policy must explicitly designate Revision 3 as a normative roadmap amendment.',
);
requireText(
  tauriPolicy,
  '## Tauri exit rule for #332 — authoritative',
  'The Tauri policy must have exactly one named authoritative #332 stop rule.',
);
if ((tauriPolicy.match(/## Tauri exit rule for #332/g) ?? []).length !== 1) {
  failures.push('The Tauri policy must contain exactly one #332 exit-rule heading.');
}
requireText(
  tauriPolicy,
  'clean process tree with no orphaned WorldScript WebKit/GPU/helper process',
  'The lifecycle acceptance policy must reject orphan processes after close/relaunch.',
);

// QNBS-v3: Keep cross-cutting ownership/reuse governance mechanically present without turning the companion policy into another roadmap.
requireText(
  reusePolicy,
  'Capability boundaries before package/crate boundaries',
  'Architecture governance must retain the capability-before-crate/package rule.',
);
requireText(
  reusePolicy,
  'Reuse-first architecture gate',
  'Architecture governance must retain the explicit existing-authority/seed audit.',
);
requireText(
  reusePolicy,
  'ONE AUTHORITY PER SEMANTIC CAPABILITY',
  'Architecture governance must preserve one semantic authority per capability.',
);
requireText(
  reusePolicy,
  'Scenario specification / fixture / metrics / thresholds',
  'Cross-renderer governance must share scenario semantics without requiring a mega-driver.',
);
requireText(
  reusePolicy,
  'A PWA runtime-capability registry must not replace feature flags.',
  'PWA runtime capability and product feature-admission truth must remain separate.',
);
requireText(
  reusePolicy,
  'Do not introduce a second live-project authority to add OPFS or user-selected file handles.',
  'PWA storage enhancements must not create a silent second live-project authority.',
);
requireText(
  reusePolicy,
  'A second independent update manager is forbidden unless the old path is explicitly retired.',
  'PWA update hardening must refine or retire the existing SW/update path rather than duplicate it.',
);
requireText(
  reusePolicy,
  /do not create a second general task framework/i,
  'Deferred PWA work must reuse task execution architecture rather than duplicate it.',
);

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
  earlyGates,
  'Linux graphics differential',
  'Qt qualification must include the Revision-3 Linux graphics differential lane.',
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
requireText(
  nativeReadiness,
  '`pnpm run native-readiness:check` runs in the CI quality job',
  'Native-readiness documentation must describe the CI policy gate.',
);
requireText(
  nativeReadiness,
  'roadmap sequencing; it does not promote any planned lane to a higher maturity level.',
  'Native-readiness documentation must not promote planned work to a higher maturity level.',
);

if (failures.length > 0) {
  console.error('Native-readiness policy check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    'Native-readiness policy check passed: canonical sequencing, scoped Revision-3 transfer gates, Tauri stop policy, reuse/ownership governance, maturity vocabulary, GPUI boundary, and Wave 5 sequencing are consistent.',
  );
}
