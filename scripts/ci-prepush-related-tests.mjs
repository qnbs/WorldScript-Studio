import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// QNBS-v3: a bounded local run keeps a 2-core machine usable; a larger set is reported as deferred, never silently dropped.
export const RELATED_TEST_LIMIT = 8;

// QNBS-v3: the repo-wide typecheck and a related-test run legitimately exceed the 120 s default child bound on a 2-core machine; still bounded, never unlimited.
export const LOCAL_CHECK_TIMEOUTS_MS = Object.freeze({ typecheck: 600_000, relatedTests: 480_000 });

// QNBS-v3: mirrors the include list of vitest.config.ts exactly; a selected file Vitest would not run makes `vitest run` fail.
const UNIT_TEST_LOCATIONS = [
  /^tests\/.+\.(?:test|spec)\.tsx?$/,
  /^components\/.+\.(?:test|spec)\.tsx?$/,
  /^packages\/[^/]+\/tests\/.+\.(?:test|spec)\.tsx?$/,
];
const TEST_FILE = /\.(?:test|spec)\.[^/]+$/;
const TS_FAMILY = new Set(['.ts', '.tsx', '.mts', '.cts']);
const BASENAME_FAMILY = new Set(['.yml', '.yaml', '.mjs', '.cjs', '.js', '.json']);
const SOURCE_EXTENSIONS = new Set([...TS_FAMILY, ...BASENAME_FAMILY]);
const EXCLUDED_JSON_ROOTS = [
  'locales/',
  'public/',
  'community-templates/',
  'docs/',
  'reports/',
  'tests/',
];
const GENERIC_BASENAME = /^(?:index|types|constants|utils)\.|^package\.json$|^tsconfig[^/]*\.json$/;
const EXCLUDED_TEST_ROOTS = ['tests/e2e/', 'node_modules/', '.worktrees/'];

export function isUnitTestFile(file) {
  return (
    UNIT_TEST_LOCATIONS.some((location) => location.test(file)) &&
    !EXCLUDED_TEST_ROOTS.some((root) => file.startsWith(root))
  );
}

function isGovernedSource(file) {
  const extension = extname(file);
  if (!SOURCE_EXTENSIONS.has(extension) || TEST_FILE.test(file)) return false;
  return extension !== '.json' || !EXCLUDED_JSON_ROOTS.some((root) => file.startsWith(root));
}

/** Strings that a test mentions when it reads or imports `file`; workflows are read by basename. */
export function relatedTestNeedles(file) {
  if (!isGovernedSource(file)) return [];
  const extension = extname(file);
  const needles = new Set([file]);
  if (TS_FAMILY.has(extension)) needles.add(file.slice(0, -extension.length));
  if (BASENAME_FAMILY.has(extension) && !GENERIC_BASENAME.test(basename(file))) {
    needles.add(basename(file));
  }
  // QNBS-v3: a bare generic name such as package.json would match nearly every test, so only path-qualified needles survive.
  return [...needles].filter((needle) => needle.includes('/') || !GENERIC_BASENAME.test(needle));
}

// QNBS-v3: git grep exits 1 for "no match", which is a normal empty result and not a failure.
function searchTestsWithGit(needle) {
  try {
    const output = execFileSync(
      'git',
      [
        'grep',
        '-l',
        '-F',
        '-e',
        needle,
        '--',
        '*.test.ts',
        '*.test.tsx',
        '*.spec.ts',
        '*.spec.tsx',
      ],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    return output.split('\n').filter(Boolean);
  } catch (error) {
    if (error?.status === 1) return [];
    throw error;
  }
}

/**
 * Picks the unit tests worth running before a push: the changed test files themselves plus every
 * test that mentions a changed source, workflow or script. Returns status NONE, RUN or DEFERRED.
 */
export function selectRelatedTests(
  changedFiles,
  {
    search = searchTestsWithGit,
    exists = (file) => existsSync(join(repoRoot, file)),
    limit = RELATED_TEST_LIMIT,
  } = {},
) {
  const selected = new Set(changedFiles.filter((file) => isUnitTestFile(file) && exists(file)));
  for (const file of changedFiles) {
    for (const needle of relatedTestNeedles(file)) {
      for (const test of search(needle)) if (isUnitTestFile(test)) selected.add(test);
    }
  }
  const tests = [...selected].sort();
  if (tests.length === 0) return { status: 'NONE', tests, total: 0 };
  return { status: tests.length > limit ? 'DEFERRED' : 'RUN', tests, total: tests.length };
}
