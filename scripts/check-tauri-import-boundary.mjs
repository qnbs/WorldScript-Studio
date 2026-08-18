#!/usr/bin/env node
/**
 * DesktopPlatform import-boundary gate (Wave 1, docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §8).
 *
 * Application source should route all desktop-capability access through `desktopPlatform`
 * (`@domain/desktop-contracts`) instead of importing `@tauri-apps/*` directly — that's the whole
 * point of the DesktopPlatform boundary: a future CEF adapter slots in without touching any
 * consumer again. This is a strict zero-tolerance gate (unlike the suppression ratchet in
 * check-suppressions.mjs): any real `@tauri-apps/*` import specifier found in application source
 * outside the explicitly approved locations below fails the build. Comment-only mentions (JSDoc,
 * `//` notes) are not flagged — only actual `import ... from`, `import(...)`, `require(...)`.
 *
 * Run: node scripts/check-tauri-import-boundary.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Directories that never contain application source we want to boundary-check. Tests are exempt
// wholesale — mocking a module specifier (`vi.mock('@tauri-apps/...')`) is not real coupling; it
// often mocks the leaf dependency of an already-compliant adapter (e.g. tauriTaskBridge.test.ts
// mocks @tauri-apps/api/core to drive the real tauriDesktopPlatform adapter end-to-end).
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-storybook',
  'storybook-static',
  'coverage',
  '.git',
  'reports',
  'graphify-out',
  '.codegraph',
  'playwright-report',
  'test-results',
  'src-tauri', // Rust + target/, no .ts
  'tests', // test mocks are exempt — see comment above
  '.storybook',
]);

const SRC_EXT = new Set(['.ts', '.tsx']);

// The approved DesktopPlatform boundary (packages/desktop-contracts/src/) plus documented
// exceptions, each with a concrete reason it cannot route through desktopPlatform today:
//   - services/ai/fetchAdapter.ts, services/localServerHttp.ts: PERMANENT — the HTTP facet is
//     intentionally NOT part of DesktopPlatform (roadmap §8 has no HTTP facet; both files are
//     tagged Wave 10 in the coupling inventory) — see packages/desktop-contracts/src/types.ts's
//     file header. This is a stable architecture decision, not deferred debt.
//   - services/logger.ts: SCHEDULED DEBT (Wave 5/7, see docs/architecture/native-readiness.md) —
//     packages/desktop-contracts's own Tauri adapter imports services/logger for its
//     logger.warn(...) failure-observability calls. If logger.ts also imported desktopPlatform for
//     its JSONL sink, that would be a circular import (logger -> desktopPlatform ->
//     tauriDesktopPlatform -> logger). Exit condition: give packages/desktop-contracts its own
//     lightweight logging port (injected callback or plain console.warn) so it stops depending on
//     the app-level logger, then migrate logger.ts's JSONL sink onto desktopPlatform.filesystem.
const BOUNDARY_FILES = [
  'packages/desktop-contracts/src/types.ts',
  'packages/desktop-contracts/src/adapters/tauriDesktopPlatform.ts',
];
const EXCEPTION_FILES = [
  'services/ai/fetchAdapter.ts',
  'services/localServerHttp.ts',
  'services/logger.ts',
];
const ALLOWED_FILES = new Set(
  [...BOUNDARY_FILES, ...EXCEPTION_FILES].map((p) => path.join(root, p)),
);

// Real import/require syntax only — not comment mentions, JSDoc, or regex literals like
// `/^@tauri-apps\//` (vite.config.ts's external-packages matcher). Matches:
//   import '@tauri-apps/...';        (bare side-effect import)
//   import x from '@tauri-apps/...';
//   import('@tauri-apps/...');
//   require('@tauri-apps/...');
const IMPORT_RE =
  /(?:^\s*import\s+['"]|from\s+['"]|import\(\s*['"]|require\(\s*['"])@tauri-apps\//m;

// QNBS-v3: scans first-party TS/TSX source (not node_modules/tests/build config) since the guardrail's job is bounding application-owned coupling, not third-party or test-mock code
/** Recursively collect first-party .ts/.tsx files. */
function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), out);
    } else if (SRC_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Marks which lines are entirely inside a comment (`//...` or a `/* ... *\/` block, tracked across
 * lines so a multi-line block is caught even when a continuation line doesn't start with `*`).
 * Deliberately line-based, not a character-level tokenizer: distinguishing a `/` regex-literal
 * delimiter from a division operator or a comment starter is a genuinely hard JS-tokenization
 * problem (this file's own `external: isTauri ? [] : [/^@tauri-apps\//]` and the `manualChunks`
 * regex filters are exactly this kind of literal) — a naive character scanner misreads them and
 * produces false positives/negatives, which is worse than the narrower gap it would close. This
 * only needs to know "is this whole line commented out," not parse an AST.
 */
function commentLineMask(text) {
  const lines = text.split('\n');
  const inComment = new Array(lines.length).fill(false);
  let insideBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (insideBlock) {
      inComment[i] = true;
      if (trimmed.includes('*/')) insideBlock = false;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      inComment[i] = true;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      inComment[i] = true;
      if (!trimmed.includes('*/')) insideBlock = true;
    }
  }
  return inComment;
}

const files = collect(root, []);
/** @type {{ file: string, line: number, text: string }[]} */
const violations = [];

for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const inComment = commentLineMask(text);
  for (let i = 0; i < lines.length; i++) {
    if (inComment[i]) continue;
    if (IMPORT_RE.test(lines[i])) {
      violations.push({ file: path.relative(root, file), line: i + 1, text: lines[i].trim() });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[guardrail:desktop-imports] FAIL — ${violations.length} direct @tauri-apps/* import(s) found outside the approved DesktopPlatform boundary:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    '\nRoute desktop-capability access through desktopPlatform (@domain/desktop-contracts) instead. ' +
      'If this is a genuine new structural exception, add it to ALLOWED_FILES in ' +
      'scripts/check-tauri-import-boundary.mjs with a documented reason.',
  );
  process.exit(1);
}

console.log(
  `[guardrail:desktop-imports] OK — 0 direct @tauri-apps/* imports outside the DesktopPlatform boundary (${files.length} files scanned, ${BOUNDARY_FILES.length} approved boundary files, ${EXCEPTION_FILES.length} documented exceptions).`,
);
