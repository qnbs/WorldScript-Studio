import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const MAX_DIAGNOSTICS_PER_FILE = 20;

function runGitCheck(args, label) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status === 0) return true;
  // QNBS-v3: preserve Git's stdout diagnostics so rejected lines are actionable.
  const diagnostics = [result.stdout, result.stderr]
    .filter((value) => value?.trim())
    .map((value) => value.trim())
    .join('\n');
  console.error(`${label} failed${diagnostics ? `:\n${diagnostics}` : ''}`);
  return false;
}

// QNBS-v3: scan untracked files incrementally so binary assets cannot exhaust local admission memory.
export function checkUntrackedFile(path) {
  if (!lstatSync(path).isFile()) return [];
  const errors = [];
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let descriptor;
  let bytesRead;
  let lineNumber = 1;
  let lineStarted = false;
  let inIndentation = true;
  let indentationHasSpace = false;
  let startsWithSpaceThenTab = false;
  let lineHasBytes = false;
  let trailingBlankLines = 0;
  let previousByte = null;
  let lastByte = null;
  let diagnosticLimitReached = false;

  const finishLine = () => {
    const contentEnd = lastByte === 13 ? previousByte : lastByte;
    if (contentEnd === 32 || contentEnd === 9)
      errors.push(`${path}:${lineNumber}: trailing whitespace`);
    if (startsWithSpaceThenTab)
      errors.push(`${path}:${lineNumber}: space before tab in indentation`);
    if (lineHasBytes) trailingBlankLines = 0;
    else trailingBlankLines += 1;
    lineNumber += 1;
    lineStarted = false;
    inIndentation = true;
    indentationHasSpace = false;
    startsWithSpaceThenTab = false;
    lineHasBytes = false;
    previousByte = null;
    lastByte = null;
    diagnosticLimitReached = errors.length >= MAX_DIAGNOSTICS_PER_FILE;
  };

  try {
    descriptor = openSync(path, 'r');
    do {
      bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      for (const byte of chunk.subarray(0, bytesRead)) {
        if (byte === 0) return [];
        if (byte === 10) {
          finishLine();
          if (diagnosticLimitReached) break;
          continue;
        }
        if (byte !== 13) lineHasBytes = true;
        previousByte = lastByte;
        lastByte = byte;
        if (!lineStarted) {
          if (inIndentation && byte === 32) {
            indentationHasSpace = true;
          } else if (inIndentation && byte === 9) {
            startsWithSpaceThenTab ||= indentationHasSpace;
          } else {
            inIndentation = false;
            lineStarted = true;
          }
        }
      }
      if (diagnosticLimitReached) break;
    } while (bytesRead > 0);
    if (!diagnosticLimitReached && (lineStarted || lastByte !== null)) finishLine();
    if (!diagnosticLimitReached && trailingBlankLines > 0) {
      errors.push(`${path}:${lineNumber - trailingBlankLines}: new blank line at EOF`);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (diagnosticLimitReached) {
    errors.push(
      `${path}: additional whitespace diagnostics suppressed after ${MAX_DIAGNOSTICS_PER_FILE}`,
    );
  }
  return errors;
}

function runCheck() {
  if (!runGitCheck(['diff', '--check', 'HEAD'], 'working-tree diff check')) process.exit(1);

  const explicitRanges = (process.env.WORLD_SCRIPT_PREPUSH_DIFF_RANGES ?? '')
    .split('\n')
    .map((range) => range.trim())
    .filter(Boolean);
  const hasExplicitRanges = Object.hasOwn(process.env, 'WORLD_SCRIPT_PREPUSH_DIFF_RANGES');
  // QNBS-v3: compare exact remote and local tips for outgoing diff integrity.
  const ranges = hasExplicitRanges
    ? explicitRanges
    : (process.env.WORLD_SCRIPT_PREPUSH_UPDATES ?? '')
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 4)
        .filter(([, localSha]) => !/^0+$/.test(localSha))
        .map(([, localSha, , remoteSha]) => {
          if (!/^0+$/.test(remoteSha)) return `${remoteSha}..${localSha}`;
          const originMain = spawnSync('git', ['rev-parse', 'origin/main'], {
            cwd: process.cwd(),
            encoding: 'utf8',
          });
          if (originMain.status !== 0) throw new Error('origin/main cannot be resolved');
          return `${originMain.stdout.trim()}..${localSha}`;
        });
  for (const range of ranges) {
    if (!/^[0-9a-f]+\.\.[0-9a-f]+$/i.test(range)) {
      console.error(`outgoing diff check received an invalid range: ${range}`);
      process.exit(1);
    }
    if (!runGitCheck(['diff', '--check', range], 'outgoing diff check')) process.exit(1);
  }

  const untrackedResult = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (untrackedResult.status !== 0) process.exit(1);
  const untracked = (untrackedResult.stdout ?? '')
    .split('\0')
    .filter(
      (path) => path && !path.startsWith('.worktrees/') && !path.startsWith('recovery-artifacts/'),
    );
  const errors = [];
  for (const path of untracked) errors.push(...checkUntrackedFile(path));
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCheck();
  } catch {
    process.exit(1);
  }
}
