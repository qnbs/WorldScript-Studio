import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { classifyFile } from './ci-prepush-classifier.mjs';

// QNBS-v3: a distinct, stricter gate from CLAUDE.md's ~100-file CodeAnt-visibility rule (different purpose).
const TIERS = {
  target: { files: 8, lines: 400, commits: 6 },
  hard: { files: 20, lines: 1200, commits: 10 },
  docsGovernance: { files: 15, lines: 2400, commits: 8 },
  absolute: { files: 30, lines: 3000, commits: 15 },
};

const EXCEPTION_REGISTRY_PATH = 'config/pr-size-exceptions.json';
const REQUIRED_EXCEPTION_SCHEMA_VERSION = 1;

function runGit(args, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const result = spawn('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

// QNBS-v3: $GIT_DIR/info/attributes outranks the PR's own tracked .gitattributes and is never versioned.
function resolveInfoAttributesPath(dependencies = {}) {
  const output = runGit(['rev-parse', '--git-path', 'info/attributes'], dependencies);
  return output === null ? null : output.trim();
}

// QNBS-v3: a PR-controlled "path -diff" in .gitattributes hides edits from numstat — override locally.
// QNBS-v3: "!diff" unspecifies (not forces-true) so genuine binaries still auto-detect, unlike a bare "diff".
function withNeutralizedDiffAttribute(dependencies, fn) {
  const readFile = dependencies.readFileSync ?? readFileSync;
  const writeFile = dependencies.writeFileSync ?? writeFileSync;
  const exists = dependencies.existsSync ?? existsSync;
  const unlink = dependencies.unlinkSync ?? unlinkSync;
  const attrPath = resolveInfoAttributesPath(dependencies);
  if (!attrPath) return fn();
  const hadFile = exists(attrPath);
  const original = hadFile ? readFile(attrPath, 'utf8') : '';
  try {
    const separator = original && !original.endsWith('\n') ? '\n' : '';
    writeFile(attrPath, `${original}${separator}* !diff\n`);
  } catch {
    return fn(); // best-effort — proceed unprotected rather than fail the whole check
  }
  try {
    return fn();
  } finally {
    try {
      if (hadFile) writeFile(attrPath, original);
      else unlink(attrPath);
    } catch {
      // best-effort restore; a leftover override in a CI-ephemeral checkout is harmless
    }
  }
}

// QNBS-v3: -z gives raw UTF-8 paths (git otherwise octal-escapes non-ASCII) and keeps rename detection.
export function getChangedFilesNumstat(base, head, dependencies = {}) {
  return withNeutralizedDiffAttribute(dependencies, () =>
    runGit(['diff', '--numstat', '-z', `${base}...${head}`], dependencies),
  );
}

export function getCommitCount(base, head, dependencies = {}) {
  const output = runGit(['rev-list', '--count', `${base}..${head}`], dependencies);
  if (output === null) return null;
  const count = Number.parseInt(output.trim(), 10);
  return Number.isFinite(count) ? count : null;
}

const NUMSTAT_HEADER = /^(-|\d+)\t(-|\d+)\t(.*)$/s;

// QNBS-v3: binary files report "-\t-\t..." — treated as 0 meaningful lines, not NaN.
// QNBS-v3: -z rename records are 3 NUL-separated tokens (numbers, old path, new path) — not 1.
export function parseNumstat(numstatOutput) {
  const tokens = numstatOutput.split('\0').filter((token) => token.length > 0);
  const rows = [];
  let i = 0;
  while (i < tokens.length) {
    const match = NUMSTAT_HEADER.exec(tokens[i]);
    if (!match) {
      i += 1;
      continue;
    }
    const [, addedRaw, removedRaw, inlinePath] = match;
    const added = addedRaw === '-' ? 0 : Number.parseInt(addedRaw, 10);
    const removed = removedRaw === '-' ? 0 : Number.parseInt(removedRaw, 10);
    if (inlinePath) {
      rows.push({ path: inlinePath, added, removed });
      i += 1;
    } else {
      // Renamed: this record's numbers token has an empty path — old/new path follow as separate tokens.
      const newPath = tokens[i + 2] ?? '';
      rows.push({ path: newPath, added, removed });
      i += 3;
    }
  }
  return rows;
}

// QNBS-v3: build-i18n.mjs only ever writes <lang>/bundle.json — a same-named non-bundle file must still count.
const LOCALE_BUNDLE_PATTERN = /^public\/locales\/[^/]+\/bundle\.json$/;
// QNBS-v3: only index.json is content-guard's mirror of community-templates/ — index.<locale>.json are hand-authored.
const GENERATED_ARTIFACT_EXACT_PATHS = ['public/community-templates/index.json'];

function isGovernanceExcluded(path) {
  if (path.split('/').pop() === 'pnpm-lock.yaml') return true;
  if (GENERATED_ARTIFACT_EXACT_PATHS.includes(path)) return true;
  return LOCALE_BUNDLE_PATTERN.test(path);
}

export function computeMeaningfulLines(rows) {
  let total = 0;
  for (const row of rows) {
    if (isGovernanceExcluded(row.path)) continue;
    total += row.added + row.removed;
  }
  return total;
}

function allowanceMap(exception) {
  return new Map(
    exception?.supplementalLineAllowances.map((allowance) => [allowance.path, allowance]) ?? [],
  );
}

export function computeNonExemptMeaningfulLines(rows, exception) {
  const allowances = allowanceMap(exception);
  return rows.reduce((total, row) => {
    if (isGovernanceExcluded(row.path) || allowances.has(row.path)) return total;
    return total + row.added + row.removed;
  }, 0);
}

export function computeSupplementalReportLines(rows, exception) {
  return Object.fromEntries(
    exception.supplementalLineAllowances.map(({ path }) => [
      path,
      rows
        .filter((row) => row.path === path && !isGovernanceExcluded(row.path))
        .reduce((total, row) => total + row.added + row.removed, 0),
    ]),
  );
}

function isValidPositiveInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// QNBS-v3: keep every registry path relative, literal, and free of traversal syntax.
function isSafeRegistryPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !/[*?[\]]/.test(value)
  );
}

function validateExceptionRegistry(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.schemaVersion !== REQUIRED_EXCEPTION_SCHEMA_VERSION
  ) {
    throw new Error(
      `invalid ${EXCEPTION_REGISTRY_PATH}: expected schemaVersion ${REQUIRED_EXCEPTION_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(value.exceptions)) {
    throw new Error(`invalid ${EXCEPTION_REGISTRY_PATH}: exceptions must be an array`);
  }

  const ids = new Set();
  return value.exceptions.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} is not an object`);
    }
    const requiredStrings = ['id', 'repository', 'baseRef', 'headRef', 'reason'];
    for (const field of requiredStrings) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has invalid ${field}`,
        );
      }
    }
    if (ids.has(entry.id)) {
      throw new Error(`invalid ${EXCEPTION_REGISTRY_PATH}: duplicate exception id ${entry.id}`);
    }
    ids.add(entry.id);
    if (!isValidPositiveInteger(entry.prNumber) || entry.prNumber < 1) {
      throw new Error(
        `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has invalid prNumber`,
      );
    }
    for (const field of ['maxFiles', 'maxCommits', 'maxNonExemptMeaningfulLines']) {
      if (!isValidPositiveInteger(entry[field])) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has invalid ${field}`,
        );
      }
    }
    if (!Array.isArray(entry.allowedPaths) || entry.allowedPaths.length === 0) {
      throw new Error(`invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} needs allowedPaths`);
    }
    for (const path of entry.allowedPaths) {
      if (!isSafeRegistryPath(path)) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has invalid allowed path`,
        );
      }
    }
    if (!Array.isArray(entry.supplementalLineAllowances)) {
      throw new Error(
        `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} needs supplementalLineAllowances`,
      );
    }
    const supplementalPaths = new Set();
    for (const allowance of entry.supplementalLineAllowances) {
      if (
        !allowance ||
        !isSafeRegistryPath(allowance.path) ||
        !isValidPositiveInteger(allowance.maxMeaningfulLines)
      ) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has invalid supplemental allowance`,
        );
      }
      if (supplementalPaths.has(allowance.path)) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} has a duplicate supplemental path ${allowance.path}`,
        );
      }
      if (!entry.allowedPaths.includes(allowance.path)) {
        throw new Error(
          `invalid ${EXCEPTION_REGISTRY_PATH}: exception ${index} supplemental path ${allowance.path} is not in allowedPaths`,
        );
      }
      supplementalPaths.add(allowance.path);
    }
    return entry;
  });
}

function getPullRequestIdentity(dependencies = {}) {
  const env = dependencies.env ?? process.env;
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !env.GITHUB_EVENT_PATH) return null;
  const readFile = dependencies.readFileSync ?? readFileSync;
  try {
    const payload = JSON.parse(readFile(env.GITHUB_EVENT_PATH, 'utf8'));
    const repository = payload?.repository?.full_name;
    const number = payload?.number;
    const baseRef = payload?.pull_request?.base?.ref;
    const headRef = payload?.pull_request?.head?.ref;
    if (
      typeof repository !== 'string' ||
      !Number.isInteger(number) ||
      number < 1 ||
      typeof baseRef !== 'string' ||
      typeof headRef !== 'string'
    ) {
      return null;
    }
    return { repository, prNumber: number, baseRef, headRef };
  } catch {
    return null;
  }
}

function readBaseExceptionRegistry(base, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const baseCheck = spawn('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    encoding: 'utf8',
  });
  if (baseCheck.error || baseCheck.status !== 0) {
    throw new Error('could not verify the base commit while loading PR-size governance');
  }
  const exists = spawn('git', ['cat-file', '-e', `${base}:${EXCEPTION_REGISTRY_PATH}`], {
    encoding: 'utf8',
  });
  if (exists.error) throw new Error(`could not inspect ${EXCEPTION_REGISTRY_PATH} on the base ref`);
  if (exists.status !== 0) return null;
  const shown = spawn('git', ['show', `${base}:${EXCEPTION_REGISTRY_PATH}`], { encoding: 'utf8' });
  if (shown.error || shown.status !== 0) {
    throw new Error(`could not read ${EXCEPTION_REGISTRY_PATH} from the base ref`);
  }
  try {
    return validateExceptionRegistry(JSON.parse(shown.stdout));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`invalid ${EXCEPTION_REGISTRY_PATH}`)) {
      throw error;
    }
    throw new Error(`invalid ${EXCEPTION_REGISTRY_PATH}: malformed JSON`);
  }
}

function getChangedPaths(base, head, dependencies = {}) {
  const output = runGit(
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`],
    dependencies,
  );
  if (output === null) return null;
  return output.split('\0').filter(Boolean);
}

function resolveException(base, head, dependencies = {}) {
  const identity = getPullRequestIdentity(dependencies);
  if (!identity)
    return { applied: false, identityMatch: false, pathScopeMatch: false, baseGoverned: false };
  const registry = readBaseExceptionRegistry(base, dependencies);
  if (!registry)
    return { applied: false, identityMatch: false, pathScopeMatch: false, baseGoverned: true };
  const matches = registry.filter(
    (entry) =>
      entry.repository === identity.repository &&
      entry.prNumber === identity.prNumber &&
      entry.baseRef === identity.baseRef &&
      entry.headRef === identity.headRef,
  );
  if (matches.length > 1) throw new Error('ambiguous PR-size exception matches on the base ref');
  const entry = matches[0];
  if (!entry)
    return { applied: false, identityMatch: false, pathScopeMatch: false, baseGoverned: true };
  const changedPaths = getChangedPaths(base, head, dependencies);
  if (changedPaths === null)
    throw new Error('could not resolve changed paths for PR-size exception scope');
  const pathScopeMatch = changedPaths.every((path) => entry.allowedPaths.includes(path));
  return {
    applied: pathScopeMatch,
    identityMatch: true,
    pathScopeMatch,
    baseGoverned: true,
    ...(pathScopeMatch ? { entry } : {}),
  };
}

// QNBS-v3: a locale-parity edit always touches 19 rebuilt bundles — exclude them, mirroring lines.
export function computeGovernedFileCount(rows) {
  return rows.filter((row) => !isGovernanceExcluded(row.path)).length;
}

export function isAllDocs(rows) {
  if (rows.length === 0) return false;
  return rows.every((row) => classifyFile(row.path) === 'DOCS');
}

// QNBS-v3: absolute is a fixed ceiling; docsGovernance replaces hard (not target) for all-DOCS PRs.
export function selectSeverity({ fileCount, lineCount, commitCount, allDocs }) {
  const overAbsolute =
    fileCount > TIERS.absolute.files ||
    lineCount > TIERS.absolute.lines ||
    commitCount > TIERS.absolute.commits;
  if (overAbsolute) return { tier: 'absolute', blocking: true, limits: TIERS.absolute };

  const midTier = allDocs ? 'docsGovernance' : 'hard';
  const midLimits = TIERS[midTier];
  const overMid =
    fileCount > midLimits.files || lineCount > midLimits.lines || commitCount > midLimits.commits;
  if (overMid) return { tier: midTier, blocking: false, limits: midLimits };

  const overTarget =
    fileCount > TIERS.target.files ||
    lineCount > TIERS.target.lines ||
    commitCount > TIERS.target.commits;
  if (overTarget) return { tier: 'target', blocking: false, limits: TIERS.target };

  return { tier: 'ok', blocking: false, limits: TIERS.target };
}

export function formatReport({
  fileCount,
  totalFileCount,
  lineCount,
  commitCount,
  allDocs,
  severity,
}) {
  const { tier, blocking, limits } = severity;
  const filesNote = totalFileCount > fileCount ? ` (${totalFileCount} total incl. generated)` : '';
  if (tier === 'ok') {
    return `PR size within target: ${fileCount} files${filesNote}, ${lineCount} meaningful lines, ${commitCount} commits (limit: ≤${limits.files}/≤${limits.lines}/≤${limits.commits}).`;
  }
  const kind = blocking ? 'exceeds the absolute ceiling' : `is over the ${tier} tier`;
  const profile = allDocs ? 'docs/governance' : 'normal';
  return `PR size ${kind} (${profile} profile): ${fileCount} files${filesNote}, ${lineCount} meaningful lines, ${commitCount} commits — limit ≤${limits.files} files / ≤${limits.lines} lines / ≤${limits.commits} commits. ${blocking ? 'Split this PR into smaller, independently reviewable PRs before merge.' : 'Consider splitting into smaller, independently reviewable PRs.'}`;
}

function formatExceptionReport({
  fileCount,
  totalLineCount,
  nonExemptLineCount,
  supplementalReportLines,
  commitCount,
  exception,
  blocking,
}) {
  const allowanceText = Object.entries(supplementalReportLines)
    .map(([path, count]) => {
      const allowance = exception.entry.supplementalLineAllowances.find(
        (item) => item.path === path,
      );
      return `${path}=${count}/${allowance.maxMeaningfulLines}`;
    })
    .join(', ');
  const status = blocking ? 'BLOCKED' : 'APPLIED';
  return (
    `PR_SIZE_EXCEPTION=${status} outcome=${blocking ? 'blocked' : 'within target'} ` +
    `id=${exception.entry.id} pr=#${exception.entry.prNumber} ` +
    `scope=${fileCount}/${exception.entry.maxFiles} files ` +
    `TOTAL_MEANINGFUL_LINES=${totalLineCount} ` +
    `NON_EXEMPT_MEANINGFUL_LINES=${nonExemptLineCount}/${exception.entry.maxNonExemptMeaningfulLines} ` +
    `SUPPLEMENTAL_REPORT_LINES=${allowanceText} ` +
    `commits=${commitCount}/${exception.entry.maxCommits} ` +
    `BASE_GOVERNED=${exception.baseGoverned ? 'YES' : 'NO'} ` +
    `IDENTITY_MATCH=${exception.identityMatch ? 'YES' : 'NO'} ` +
    `PATH_SCOPE_MATCH=${exception.pathScopeMatch ? 'YES' : 'NO'} ` +
    `EFFECTIVE_LIMITS=files<=${exception.entry.maxFiles};nonExemptLines<=${exception.entry.maxNonExemptMeaningfulLines};commits<=${exception.entry.maxCommits}`
  );
}

export function evaluatePrSize(base, head, dependencies = {}) {
  const numstat = getChangedFilesNumstat(base, head, dependencies);
  const commitCount = getCommitCount(base, head, dependencies);
  if (numstat === null || commitCount === null) {
    return { ok: false, error: 'could not resolve diff/commit range via git' };
  }
  const rows = parseNumstat(numstat);
  const totalFileCount = rows.length;
  const fileCount = computeGovernedFileCount(rows);
  const lineCount = computeMeaningfulLines(rows);
  const allDocs = isAllDocs(rows);
  let exception;
  try {
    exception = resolveException(base, head, dependencies);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'invalid PR-size exception governance',
    };
  }
  const nonExemptLineCount = exception.entry
    ? computeNonExemptMeaningfulLines(rows, exception.entry)
    : lineCount;
  const supplementalReportLines = exception.entry
    ? computeSupplementalReportLines(rows, exception.entry)
    : {};
  const exceptionWithinLimits =
    !exception.entry ||
    (fileCount <= exception.entry.maxFiles &&
      commitCount <= exception.entry.maxCommits &&
      nonExemptLineCount <= exception.entry.maxNonExemptMeaningfulLines &&
      Object.entries(supplementalReportLines).every(([path, count]) => {
        const allowance = exception.entry.supplementalLineAllowances.find(
          (item) => item.path === path,
        );
        return count <= allowance.maxMeaningfulLines;
      }));
  const severity =
    exception.entry && !exceptionWithinLimits
      ? {
          tier: 'absolute',
          blocking: true,
          limits: {
            files: exception.entry.maxFiles,
            lines: exception.entry.maxNonExemptMeaningfulLines,
            commits: exception.entry.maxCommits,
          },
        }
      : selectSeverity({ fileCount, lineCount: nonExemptLineCount, commitCount, allDocs });
  return {
    ok: true,
    fileCount,
    totalFileCount,
    lineCount,
    commitCount,
    allDocs,
    nonExemptLineCount,
    supplementalReportLines,
    exception: {
      applied: Boolean(exception.entry),
      ...(exception.entry ? { id: exception.entry.id } : {}),
      identityMatch: exception.identityMatch,
      pathScopeMatch: exception.pathScopeMatch,
      baseGoverned: exception.baseGoverned,
    },
    severity,
    report: exception.entry
      ? formatExceptionReport({
          fileCount,
          totalLineCount: lineCount,
          nonExemptLineCount,
          supplementalReportLines,
          commitCount,
          exception,
          blocking: severity.blocking,
        })
      : formatReport({ fileCount, totalFileCount, lineCount, commitCount, allDocs, severity }),
  };
}

export function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('Usage: node scripts/check-pr-size.mjs <base-sha> <head-sha>');
    process.exitCode = 1;
    return;
  }
  const result = evaluatePrSize(base, head);
  if (!result.ok) {
    console.error(`[check-pr-size] ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check-pr-size] ${result.report}`);
  if (result.severity.blocking) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
