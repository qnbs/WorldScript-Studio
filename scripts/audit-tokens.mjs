#!/usr/bin/env node
/**
 * Token & design-system audit script.
 *
 * Scans JSX/TSX source for patterns that break the token-first design system:
 *   - raw hex / rgb / hsl color literals
 *   - Tailwind `dark:` prefixes
 *   - inline shadow utilities with hard-coded color channels
 *   - inline <svg> elements (duplicated icons should use the shared Icon component)
 *
 * Exits non-zero when violations are found and writes a JSON report to reports/token-audit.json.
 * Use `--update-baseline` to snapshot the current count for ratcheting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const REPORT_PATH = path.join(root, 'reports', 'token-audit.json');
// QNBS-v3: baseline lives at repo root so it is committed (reports/ is gitignored).
const BASELINE_PATH = path.join(root, 'token-audit-baseline.json');

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const showDetails = args.includes('--details');

// QNBS-v3: directories that contain source subject to the token-first rule.
const SOURCE_DIRS = ['components', 'app', 'hooks', 'features', 'contexts'];

// QNBS-v3: files that are allowed to contain raw colors / inline SVGs by design.
const EXCLUDED_FILES = new Set([
  // The global token file is the single source of truth for raw values.
  path.join(root, 'index.css'),
  // Storybook preview configures canvas backgrounds explicitly.
  path.join(root, '.storybook', 'preview.tsx'),
  // The icon component is the central registry for SVG paths.
  path.join(root, 'components', 'ui', 'Icon.tsx'),
]);

const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js']);

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
];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function isExcluded(filePath) {
  const normalized = path.normalize(filePath);
  if (EXCLUDED_FILES.has(normalized)) return true;
  // QNBS-v3: tests, stories, and build scripts are not held to the runtime token rule.
  if (normalized.includes(path.sep + 'tests' + path.sep)) return true;
  if (normalized.includes(path.sep + 'stories' + path.sep)) return true;
  if (normalized.includes(path.sep + 'scripts' + path.sep)) return true;
  if (normalized.includes(path.sep + 'node_modules' + path.sep)) return true;
  if (normalized.includes(path.sep + 'dist' + path.sep)) return true;
  if (normalized.includes(path.sep + 'coverage' + path.sep)) return true;
  return false;
}

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && isSourceFile(fullPath) && !isExcluded(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function findViolations(files) {
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

      // QNBS-v3: track /* ... */ block comments (including JSX {/* ... */}) so tokens
      // mentioned inside explanatory comments are not counted as violations.
      let line = rawLine;
      if (inBlockComment) {
        const endIdx = line.indexOf('*/');
        if (endIdx === -1) continue;
        line = line.slice(endIdx + 2);
        inBlockComment = false;
      }
      while (line.includes('/*')) {
        const startIdx = line.indexOf('/*');
        const endIdx = line.indexOf('*/', startIdx + 2);
        if (endIdx === -1) {
          inBlockComment = true;
          line = line.slice(0, startIdx);
          break;
        }
        line = line.slice(0, startIdx) + line.slice(endIdx + 2);
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

function main() {
  const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(root, dir)));
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
  if (baseline) {
    if (audit.total > baseline.total) {
      console.error(
        `[token-audit] FAIL: ${audit.total} violations exceeds baseline of ${baseline.total}. Run with --update-baseline after intentional fixes.`,
      );
      process.exit(1);
    }
    console.log(`[token-audit] PASS: ${audit.total} ≤ baseline ${baseline.total}.`);
    process.exit(0);
  }

  if (audit.total > 0) {
    console.error(
      '[token-audit] FAIL: violations found. Fix them or run with --update-baseline to establish a baseline.',
    );
    process.exit(1);
  }

  console.log('[token-audit] PASS: no violations found.');
  process.exit(0);
}

main();
