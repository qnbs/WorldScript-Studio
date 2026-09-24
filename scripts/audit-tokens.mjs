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
import { isDirectExecution, resolveModuleRoot } from './lib/cli-entrypoint.mjs';
import { evaluateBaseline } from './lib/ratchet-baseline.mjs';

export { evaluateBaseline, isDirectExecution, resolveModuleRoot };

// QNBS-v3: exported so tests can build the exact same absolute paths the module's own EXCLUDED_FILES set uses, without duplicating this resolution or touching the filesystem.
export const root = resolveModuleRoot(import.meta.url);

const REPORT_PATH = path.join(root, 'reports', 'token-audit.json');
// QNBS-v3: baseline lives at repo root so it is committed (reports/ is gitignored).
const BASELINE_PATH = path.join(root, 'token-audit-baseline.json');

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const showDetails = args.includes('--details');

// QNBS-v3 (Codex, PR #817): the full set of standard JS/TS module extensions — .mts/.cts/.mjs/.cjs are legitimate runtime-capable source, not just .ts/.tsx/.js/.jsx, and their absence here was a corpus gap independent of every other fix in this file. This is the single authority both the git ls-files pathspec (via extensionGlobs) and isSourceFile's classification read from, so the two can never drift apart.
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

function extensionGlobs() {
  return [...SOURCE_EXTENSIONS].map((ext) => `*${ext}`);
}

// QNBS-v3: ambient declaration files carry no runtime code — path.extname() alone can't detect these (it returns '.ts' for 'x.d.ts', '.mts' for 'x.d.mts', etc.), so each suffix is checked explicitly.
const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];

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
  // QNBS-v3 (live review, PR #817): "config" was REMOVED from here — config/resolveViteBase.ts is genuinely imported by services/deployTarget.ts (GITHUB_PAGES_BASE), so a blanket directory exclusion wrongly hid real runtime-consumed source. The audit's default-in contract: runtime-capable tracked JS/TS stays in the corpus, and only demonstrably build/tooling-only source is excluded by name (the *.config.ts/*.config.js basename rule below already covers vite.config.ts etc. wherever they live).
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
  // QNBS-v3 (Codex, PR #817): Lighthouse CI config at the repo root — the widened .cjs extension coverage would otherwise newly pull these into the corpus; they don't match the *.config.* basename convention (no "config" substring in the name) so need their own explicit exclusion, the same as every other named exemption in this set.
  path.join(root, '.lighthouserc.cjs'),
  path.join(root, '.lighthouserc.desktop.cjs'),
]);

// QNBS-v3: matches vite.config.ts, vitest.config.ts, playwright.config.ts, etc. anywhere in the tree — an unambiguous, ecosystem-wide naming convention for build/tooling config, never a consuming UI surface.
const BUILD_CONFIG_BASENAME = /\.config\.(ts|js|mts|cts|mjs|cjs)$/;

function isSourceFile(filePath) {
  if (DECLARATION_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) return false;
  if (BUILD_CONFIG_BASENAME.test(path.basename(filePath))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

// QNBS-v3 (Codex, PR #817): directory-segment exclusion must be checked against the path RELATIVE TO repoRoot, never the absolute path — a substring check against the absolute path lets an ancestor/checkout directory that happens to share a name with an excluded segment (e.g. a repo checked out under ".../config/WorldScript-Studio") silently exclude real source under the repo's own services/ tree, which has nothing to do with the repo's own config/ directory.
function isExcluded(filePath, repoRoot) {
  const normalized = path.normalize(filePath);
  if (EXCLUDED_FILES.has(normalized)) return true;
  const relativeSegments = path.relative(repoRoot, normalized).split(path.sep);
  return EXCLUDED_DIR_SEGMENTS.some((segment) => relativeSegments.includes(segment));
}

// QNBS-v3 (post-Visual qualification tranche, Section 3.1): derives the candidate corpus from git's own tracked-file list instead of a hand-maintained directory allowlist. Exported (not called from resolveAuditableFiles's default path in tests) so tests can inject a fixed file list rather than shelling out to git.
// QNBS-v3 (Codex, PR #817): `-z` (NUL-delimited, unquoted) is required — git's default newline-delimited output C-quotes/octal-escapes any "unusual" filename (any non-ASCII byte by default, or an embedded space/newline), so a plain `\n`-split silently turned a real path like `sübdir/ünïcode-file.ts` into the literal, non-existent string `"s\303\274bdir/..."`, dropping it from the corpus entirely.
export function getTrackedSourceFiles(repoRoot = root) {
  const raw = execFileSync('git', ['ls-files', '-z', '--', ...extensionGlobs()], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return raw
    .split('\0')
    .filter(Boolean)
    .map((relPath) => path.join(repoRoot, relPath));
}

// QNBS-v3: the classifier (isSourceFile/isExcluded) is exercised independently of file discovery, so a test can pass a synthetic candidate list without touching the real git repository or filesystem. repoRoot defaults to this module's own root (real CLI usage) but is overridable so a test can exercise an ancestor-directory-name collision without needing a real checkout at that path.
export function resolveAuditableFiles(candidateFiles, repoRoot = root) {
  return candidateFiles.filter((file) => isSourceFile(file) && !isExcluded(file, repoRoot));
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

/**
 * QNBS-v3 (CodeAnt + live review, PR #817): the audit's content-resolution contract.
 *
 * The corpus (which paths are in scope) comes from `git ls-files` — the index, not the working
 * tree. Content is read from the working tree when it exists there (the normal case, and the
 * right one for a local run: a developer auditing their current draft wants THEIR edits checked,
 * staged or not — same convention as eslint/tsc). Only when the working tree copy is missing
 * (ENOENT) does this fall back to the index's blob via `git show :<path>`, rather than silently
 * skipping — a bare skip would audit something other than what the next commit (and CI's
 * always-clean checkout) actually contains, which is exactly the local/CI parity this corpus
 * deliberately moved to git ls-files to protect.
 *
 * This resolves every real path-vs-content state without special-casing any of them individually:
 *   - clean / modified-unstaged / modified-staged / newly-staged: working tree read succeeds — no
 *     fallback involved.
 *   - unstaged deletion: still in the index (still in `git ls-files`), gone from the working tree
 *     → index fallback reads its real, about-to-ship-if-staged content.
 *   - staged deletion (`git rm`/`git add` after `rm`): gone from the index too, so `git ls-files`
 *     never lists it in the first place — this function is never even called for it.
 *   - a working-tree-only rename is, at the index level, indistinguishable from an unstaged
 *     deletion of the old path (handled above) plus an untracked new path (out of scope, same as
 *     any file that was never `git add`ed).
 *   - paths containing spaces or other shell-special characters: `execFileSync`'s argv array never
 *     goes through a shell, so no escaping is needed or applied.
 *   - Windows: the index pathspec is normalized to forward slashes before the `git show` call,
 *     since git's `:<path>` syntax requires them on every OS regardless of `path.sep`.
 *   - an unreadable/corrupt index object, or a TOCTOU race where the index changed mid-scan: the
 *     index fallback throws rather than returning null — every caller derives `files` from
 *     getTrackedSourceFiles, so a path reaching this function was in the index moments ago, and
 *     silently treating an unexpected git-show failure as "nothing to audit" could mask a real
 *     violation. This fails the whole audit closed (non-zero exit) instead.
 * Verified empirically against all of the above before this contract was written down.
 */
function readTrackedFileContent(file, repoRoot) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // QNBS-v3 (Codex, PR #817): git's `:<path>` index pathspec always uses forward slashes, on every OS — path.relative returns OS-native separators, which are backslashes on Windows. Without this normalization, `git show` fails to resolve a real index entry on Windows and would silently (and wrongly) treat it as gone from the index too.
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    // QNBS-v3 (live review, PR #817): no inner catch here — every caller in this file derives `files` from getTrackedSourceFiles (i.e. `file` was in the index moments ago), so a git-show failure at this point is never a legitimate "not tracked" case; it's a TOCTOU race (the index changed mid-scan) or an unreadable/corrupt index object. Either way this must fail the whole audit closed (a thrown error, non-zero exit) rather than silently miss content that may contain real violations — the exact failure mode the ENOENT-skip fix this replaced (1bed434) was itself found to have.
    return execFileSync('git', ['show', `:${relative}`], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

// QNBS-v3: isolates the per-line block-comment state machine and pattern matching for a single file's content, so findViolations itself stays a thin per-file orchestration loop (file discovery/skip/aggregation) instead of also carrying this function's own branching.
function scanFileForViolations(file, content, summary) {
  const fileViolations = [];
  const lines = content.split('\n');

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
      if (!matches) continue;
      for (const match of matches) {
        fileViolations.push({
          line: lineIndex + 1,
          column: line.indexOf(match) + 1,
          rule: pattern.id,
          message: pattern.label,
          match: match.slice(0, 40),
        });
        summary[pattern.id] += 1;
      }
    }
  }

  return fileViolations;
}

// QNBS-v3: repoRoot defaults to this module's own root (real CLI usage) but is overridable so tests can point it at a disposable git fixture instead of the real repository.
export function findViolations(files, repoRoot = root) {
  const byFile = {};
  const summary = {};
  let total = 0;

  for (const pattern of PATTERNS) {
    summary[pattern.id] = 0;
  }

  for (const file of files) {
    // QNBS-v3 (live review, PR #817): readTrackedFileContent no longer returns null — it throws when content is unavailable from both the working tree and the index, so the audit fails closed instead of silently skipping a file that may hold real violations.
    const content = readTrackedFileContent(file, repoRoot);
    const fileViolations = scanFileForViolations(file, content, summary);
    total += fileViolations.length;
    if (fileViolations.length > 0) {
      byFile[path.relative(repoRoot, file)] = fileViolations;
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
if (isDirectExecution(process.argv[1], import.meta.url)) {
  main();
}
