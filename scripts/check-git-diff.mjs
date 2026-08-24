import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import process from 'node:process';

function runGitCheck(args, label) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status === 0) return true;
  console.error(`${label} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return false;
}

// QNBS-v3: scan untracked files incrementally so binary assets cannot exhaust local admission memory.
function checkUntrackedFile(path) {
  if (!lstatSync(path).isFile()) return [];
  const descriptor = openSync(path, 'r');
  const errors = [];
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let bytesRead;
  let lineNumber = 1;
  let lineStarted = false;
  let leadingSpaces = 0;
  let startsWithSpaceThenTab = false;
  let previousByte = null;
  let lastByte = null;

  const finishLine = () => {
    const contentEnd = lastByte === 13 ? previousByte : lastByte;
    if (contentEnd === 32 || contentEnd === 9)
      errors.push(`${path}:${lineNumber}: trailing whitespace`);
    if (startsWithSpaceThenTab)
      errors.push(`${path}:${lineNumber}: space before tab in indentation`);
    lineNumber += 1;
    lineStarted = false;
    leadingSpaces = 0;
    startsWithSpaceThenTab = false;
    previousByte = null;
    lastByte = null;
  };

  try {
    do {
      bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      for (const byte of chunk.subarray(0, bytesRead)) {
        if (byte === 0) return [];
        if (byte === 10) {
          finishLine();
          continue;
        }
        previousByte = lastByte;
        lastByte = byte;
        if (!lineStarted) {
          if (byte === 32) leadingSpaces += 1;
          else {
            startsWithSpaceThenTab = leadingSpaces > 0 && byte === 9;
            lineStarted = true;
          }
        }
      }
    } while (bytesRead > 0);
    if (lineStarted || lastByte !== null) finishLine();
  } finally {
    closeSync(descriptor);
  }
  return errors;
}

try {
  if (!runGitCheck(['diff', '--check', 'HEAD'], 'working-tree diff check')) process.exit(1);

  const explicitRanges = (process.env.WORLD_SCRIPT_PREPUSH_DIFF_RANGES ?? '')
    .split('\n')
    .map((range) => range.trim())
    .filter(Boolean);
  const hasExplicitRanges = Object.hasOwn(process.env, 'WORLD_SCRIPT_PREPUSH_DIFF_RANGES');
  const ranges = hasExplicitRanges
    ? explicitRanges
    : (process.env.WORLD_SCRIPT_PREPUSH_UPDATES ?? '')
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 4)
        .filter(([, localSha]) => !/^0+$/.test(localSha))
        .map(([, localSha, , remoteSha]) => {
          if (!/^0+$/.test(remoteSha)) return `${remoteSha}...${localSha}`;
          const originMain = spawnSync('git', ['rev-parse', 'origin/main'], {
            cwd: process.cwd(),
            encoding: 'utf8',
          });
          if (originMain.status !== 0) throw new Error('origin/main cannot be resolved');
          return `${originMain.stdout.trim()}...${localSha}`;
        });
  for (const range of ranges) {
    if (!/^[0-9a-f]+\.\.\.[0-9a-f]+$/i.test(range)) {
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
} catch {
  process.exit(1);
}
