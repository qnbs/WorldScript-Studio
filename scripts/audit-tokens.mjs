#!/usr/bin/env node
/**
 * Token & design-system audit script.
 *
 * Scans first-party runtime JS/TS/JSX/TSX source for patterns that break the token-first design
 * system:
 *   - raw hex / rgb / hsl color literals
 *   - Tailwind `dark:` prefixes
 *   - inline shadow utilities with hard-coded color channels
 *   - inline <svg> elements (duplicated icons should use the shared Icon component)
 *   - raw --glass-* token usage (Visual Maturity #F, DS-6): the ambient glass tokens are reserved
 *     for the rare, transient overlay case DS-6 describes, not a primitive surface default.
 *
 * The candidate corpus is derived from git's own tracked-file list (see `getTrackedSourceFiles`)
 * rather than a hand-maintained directory allowlist, so a newly added runtime directory is
 * covered automatically instead of silently invisible until someone remembers to widen a list
 * (see the post-Visual-Maturity qualification tranche: `services/`, `constants/`, `packages/*\/src`,
 * `workers/`, `plugins/`, `i18n/`, `api/`, `functions/`, and `public/sw.js` were all outside the
 * historical scan and are now included).
 *
 * The baseline is a true monotonic per-rule ratchet (see `evaluateBaseline`): a rule's count must
 * equal its baselined count exactly. An increase fails as a regression; a decrease also fails,
 * because a stale-high baseline would let the count silently regrow back up to the old ceiling
 * later. `--update-baseline` is the explicit, human-triggered action that accepts the current
 * counts as the new ceiling in both directions.
 *
 * Exits non-zero when violations exceed (or newly undershoot) the baseline and writes a JSON
 * report to reports/token-audit.json. Use `--update-baseline` to snapshot the current counts.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// QNBS-v3: exported so tests can build the exact same absolute paths the module's own EXCLUDED_FILES set uses, without duplicating this resolution or touching the filesystem.
export const root = path.resolve(__dirname, '..');

const REPORT_PATH = path.join(root, 'reports', 'token-audit.json');
// QNBS-v3: baseline lives at repo root so it is committed (reports/ is gitignored).
const BASELINE_PATH = path.join(root, 'token-audit-baseline.json');

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const showDetails = args.includes('--details');

const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js']);

// QNBS-v3 (post-Visual qualification tranche, Section 3.1): directory segments that are dev tooling, generated output, or test/demo surfaces — never shipped product UI/source — excluded wherever they appear in a path, at any depth.
const EXCLUDED_DIR_SEGMENTS = [
  'tests',
  'stories',
  'scripts',
  'node_modules',
  'dist',
  'coverage',
  '.storybook',
  // QNBS-v3: a separate embedded MCP dev-tooling sub-project (own package.json/tsconfig), not shipped product UI.
  '.mcp',
  // QNBS-v3: build-time config helpers (e.g. resolveViteBase.ts) and non-source JSON, not a consuming UI surface.
  'config',
];

// QNBS-v3: files that are allowed to contain raw colors / inline SVGs by design — each is a source-of-truth or intentionally token-independent file, not an ordinary consuming UI surface.
const EXCLUDED_FILES = new Set([
  // The global token file is the single source of truth for raw values.
  path.join(root, 'index.css'),
  // The icon component is the central registry for SVG paths.
  path.join(root, 'components', 'ui', 'Icon.tsx'),
  // SectionIcon renders icons from the APP_SECTIONS central config, not duplicated inline SVGs.
  path.join(root, 'components', 'ui', 'SectionIcon.tsx'),
  // QNBS-v3: this fatal-fallback inline HTML renders when React itself failed to boot, so it must stay token/CSS-independent by design — the same reason index.css itself is excluded above.
  path.join(root, 'index.tsx'),
  // QNBS-v3 (post-Visual qualification tranche, Section 3.1): the service worker runs in its own execution context with no `document`/CSSOM — it cannot read a CSS custom property at all — so its offline-fallback SVG placeholder and notification colors are structurally outside the token system's reach, not a token-first regression.
  path.join(root, 'public', 'sw.js'),
  // QNBS-v3 (post-Visual qualification tranche, Section 3.1): generates the CSS for an exported EPUB document consumed by external e-reader software — a separate document with its own stylesheet, disconnected from this app's running CSSOM, the same rationale tier as index.css being the source of truth for the app's own raw values.
  path.join(root, 'services', 'epubApiService.ts'),
  // QNBS-v3 (post-Visual qualification tranche): the TypeScript mirror of the CSS custom-property scale (docs/Design-System.md's own "TypeScript mirrors live in packages/ui/src/tokens.ts") is a source-of-truth for raw values, the same rationale as index.css.
  path.join(root, 'packages', 'ui', 'src', 'tokens.ts'),
  // QNBS-v3: the Tailwind design-token preset defines the raw theme scale itself; same source-of-truth rationale.
  path.join(root, 'packages', 'ui', 'tailwind-preset.ts'),
]);

// QNBS-v3: matches vite.config.ts, vitest.config.ts, playwright.config.ts, etc. anywhere in the tree — an unambiguous, ecosystem-wide naming convention for build/tooling config, never a consuming UI surface.
const BUILD_CONFIG_BASENAME = /\.config\.(ts|js|mjs|cjs)$/;

function isSourceFile(filePath) {
  // QNBS-v3: ambient .d.ts declaration files carry no runtime code, so a raw-color example in a JSDoc comment (already comment-stripped anyway) is the only thing that could ever match here.
  if (filePath.endsWith('.d.ts')) return false;
  if (BUILD_CONFIG_BASENAME.test(path.basename(filePath))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function isExcluded(filePath) {
  const normalized = path.normalize(filePath);
  if (EXCLUDED_FILES.has(normalized)) return true;
  return EXCLUDED_DIR_SEGMENTS.some((segment) =>
    normalized.includes(path.sep + segment + path.sep),
  );
}

// QNBS-v3 (post-Visual qualification tranche, Section 3.1): derives the candidate corpus from git's own tracked-file list instead of a hand-maintained directory allowlist. Exported (not called from resolveAuditableFiles's default path in tests) so tests can inject a fixed file list rather than shelling out to git.
export function getTrackedSourceFiles(repoRoot = root) {
  const raw = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.jsx'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return raw
    .split('\n')
    .filter(Boolean)
    .map((relPath) => path.join(repoRoot, relPath));
}

// QNBS-v3: the classifier (isSourceFile/isExcluded) is exercised independently of file discovery, so a test can pass a synthetic candidate list without touching the real git repository or filesystem.
export function resolveAuditableFiles(candidateFiles) {
  return candidateFiles.filter((file) => isSourceFile(file) && !isExcluded(file));
}

// biome-ignore format: regex readability
const PATTERNS = [
  {
    id: 'raw-hex',
    label: 'Raw hex color literal',
    regex: /#[0-9a-fA-F]{3,8}\b/g,
    // Allow CSS custom-property fallbacks like var(--x, #fff) only in index.css.
    shouldSkip: (_file) => false,
  },
  {
    id: 'raw-rgb',
    label: 'Raw rgb/rgba color literal',
    regex: /\brgba?\s*\(/g,
    shouldSkip: (_file) => false,
  },
  {
    id: 'raw-hsl',
    label: 'Raw hsl/hsla color literal',
    regex: /\bhsla?\s*\(/g,
    shouldSkip: (_file) => false,
  },
  {
    id: 'dark-prefix',
    label: 'Tailwind dark: prefix',
    regex: /\bdark:/g,
    shouldSkip: (_file) => false,
  },
  {
    id: 'hardcoded-shadow',
    label: 'Hard-coded shadow color',
    // shadow-[...rgba(...)] or shadow-[0_4px_14px_0_rgba(99,102,241,0.39)]
    regex: /shadow-\[[^\]]*rgba?\s*\(/g,
    shouldSkip: (_file) => false,
  },
  {
    id: 'inline-svg',
    label: 'Inline <svg> (use Icon component instead)',
    regex: /<svg\b/g,
    // Some legitimate inline SVGs remain until the icon migration is complete.
    shouldSkip: (file) => file.includes(path.join('components', 'ui', 'Icon.tsx')),
  },
  {
    id: 'ambient-glass-token',
    label: 'Raw --glass-* token (Visual Maturity PR F, DS-6: ambient glass is not a primitive default)',
    // QNBS-v3 (CodeRabbit/Codex): matches the bare "--glass-name" token itself, not any surrounding syntax — this also catches getComputedStyle(el).getPropertyValue('--glass-bg') and Tailwind's bg-(...) shorthand, not just var(...).
    regex: /--glass-[\w-]+/g,
    shouldSkip: (_file) => false,
  },
];

// QNBS-v3 (Codex): a literal /* or */ inside a quoted string or JSX attribute (e.g. accept="image/*") must never be mistaken for a real comment delimiter — this blanks quoted content (keeping its length, so column positions stay accurate) for comment-boundary detection only; pattern matching itself still runs against the original, un-blanked line.
function blankStringLiterals(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (match) => ' '.repeat(match.length));
}

export function findViolations(files) {
  const byFile = {};
  const summary = {};
  let total = 0;

  for (const pattern of PATTERNS) {
    summary[pattern.id] = 0;
  }

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relative = path.relative(root, file);
    const fileViolations = [];

    let inBlockComment = false;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      if (rawLine.trim().startsWith('//')) continue; // skip line comments

      // QNBS-v3: tracks /* ... */ block comments (incl. JSX {/* ... */}) via scanLine (string literals blanked, so a literal /* inside a quoted attribute can't falsely open one) — line (unblanked) is what patterns actually match against.
      let line = rawLine;
      let scanLine = blankStringLiterals(rawLine);
      if (inBlockComment) {
        const endIdx = scanLine.indexOf('*/');
        if (endIdx === -1) continue;
        line = line.slice(endIdx + 2);
        scanLine = scanLine.slice(endIdx + 2);
        inBlockComment = false;
      }
      while (scanLine.includes('/*')) {
        const startIdx = scanLine.indexOf('/*');
        const endIdx = scanLine.indexOf('*/', startIdx + 2);
        if (endIdx === -1) {
          inBlockComment = true;
          line = line.slice(0, startIdx);
          scanLine = scanLine.slice(0, startIdx);
          break;
        }
        line = line.slice(0, startIdx) + line.slice(endIdx + 2);
        scanLine = scanLine.slice(0, startIdx) + scanLine.slice(endIdx + 2);
      }
      if (line.trim().length === 0) continue;

      for (const pattern of PATTERNS) {
        if (pattern.shouldSkip(file)) continue;
        const matches = line.match(pattern.regex);
        if (matches) {
          for (const match of matches) {
            fileViolations.push({
              line: lineIndex + 1,
              column: line.indexOf(match) + 1,
              rule: pattern.id,
              message: pattern.label,
              match: match.slice(0, 40),
            });
            summary[pattern.id] += 1;
            total += 1;
          }
        }
      }
    }

    if (fileViolations.length > 0) {
      byFile[relative] = fileViolations;
    }
  }

  return { byFile, summary, total };
}

function loadBaseline() {
  try {
    const data = fs.readFileSync(BASELINE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// QNBS-v3: sums a rule-keyed count object the same way for both the baseline file and a fresh audit run, so the two internal-consistency checks in evaluateBaseline share one definition of "the total agrees with the per-rule breakdown".
function sumSummary(summary) {
  return Object.values(summary).reduce((sum, count) => sum + count, 0);
}

/**
 * QNBS-v3 (post-Visual qualification tranche, Section 3.2): a true monotonic per-rule ratchet.
 * Every rule's count must equal its baselined count exactly — an increase is a regression, and a
 * decrease is also rejected, because leaving the baseline stale-high would let the count silently
 * regrow back up to the old ceiling in a later, unrelated change. `--update-baseline` is the only
 * way to accept a new ceiling in either direction. Exported so tests can exercise every outcome
 * (PASS / regression / stale-high) without shelling out to the real script or touching real files.
 */
export function evaluateBaseline(audit, baseline) {
  if (!baseline) {
    return audit.total > 0
      ? { ok: false, reason: 'NO_BASELINE_VIOLATIONS_FOUND' }
      : { ok: true, reason: 'NO_BASELINE_NO_VIOLATIONS' };
  }

  // QNBS-v3: a malformed baseline (its own stored total disagreeing with its own per-rule breakdown) must fail closed rather than silently ratchet against a number that was never actually true.
  const baselineSum = sumSummary(baseline.summary ?? {});
  if (baseline.summary && baselineSum !== baseline.total) {
    return {
      ok: false,
      reason: 'MALFORMED_BASELINE',
      detail: `baseline.total (${baseline.total}) !== sum(baseline.summary) (${baselineSum})`,
    };
  }

  const auditSum = sumSummary(audit.summary);
  if (auditSum !== audit.total) {
    return {
      ok: false,
      reason: 'MALFORMED_AUDIT',
      detail: `audit.total (${audit.total}) !== sum(audit.summary) (${auditSum})`,
    };
  }

  const allRuleIds = new Set([
    ...Object.keys(audit.summary),
    ...Object.keys(baseline.summary ?? {}),
  ]);
  const regressions = [];
  const staleHigh = [];
  for (const ruleId of allRuleIds) {
    const current = audit.summary[ruleId] ?? 0;
    const baselined = baseline.summary?.[ruleId] ?? 0;
    if (current > baselined) regressions.push(`${ruleId}: ${current} > ${baselined}`);
    else if (current < baselined) staleHigh.push(`${ruleId}: ${current} < ${baselined}`);
  }

  if (regressions.length > 0) {
    return { ok: false, reason: 'REGRESSION', detail: regressions.join(', ') };
  }
  if (staleHigh.length > 0) {
    return { ok: false, reason: 'STALE_HIGH_BASELINE', detail: staleHigh.join(', ') };
  }
  return { ok: true, reason: 'EXACT_MATCH' };
}

function main() {
  const files = resolveAuditableFiles(getTrackedSourceFiles());
  const audit = findViolations(files);

  const report = {
    scannedFiles: files.length,
    totalViolations: audit.total,
    summary: audit.summary,
    byFile: audit.byFile,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[token-audit] Scanned ${files.length} source files.`);
  console.log(`[token-audit] Total violations: ${audit.total}`);

  if (showDetails && audit.total > 0) {
    console.log('[token-audit] per-file breakdown:');
    for (const [file, violations] of Object.entries(audit.byFile)) {
      console.log(`  ${file}: ${violations.length}`);
      for (const v of violations.slice(0, 5)) {
        console.log(`    ${v.line}:${v.column}  ${v.rule}  "${v.match}"`);
      }
      if (violations.length > 5) {
        console.log(`    ... and ${violations.length - 5} more`);
      }
    }
  }

  console.log('[token-audit] Summary by rule:');
  for (const [rule, count] of Object.entries(audit.summary)) {
    console.log(`  ${rule}: ${count}`);
  }

  if (updateBaseline) {
    const baseline = {
      total: audit.total,
      summary: audit.summary,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`[token-audit] Baseline updated: ${audit.total} violations.`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const verdict = evaluateBaseline(audit, baseline);
  if (!verdict.ok) {
    const detail = verdict.detail ? ` — ${verdict.detail}` : '';
    console.error(
      `[token-audit] FAIL: ${verdict.reason}${detail}. Run with --update-baseline after intentional fixes.`,
    );
    process.exit(1);
  }
  console.log(
    baseline
      ? `[token-audit] PASS: ${audit.total} matches baseline ${baseline.total} exactly (per-rule).`
      : '[token-audit] PASS: no violations found.',
  );
  process.exit(0);
}

// QNBS-v3: only run the CLI when this file is executed directly — importing it (e.g. from a test file, for the exported pure helpers) must not trigger a report write or process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
