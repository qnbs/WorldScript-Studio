import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

function runGitCheck(args, label) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status === 0) return true;
  console.error(`${label} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return false;
}

try {
  if (!runGitCheck(['diff', '--check', 'HEAD'], 'working-tree diff check')) process.exit(1);

  const explicitRanges = (process.env.WORLD_SCRIPT_PREPUSH_DIFF_RANGES ?? '')
    .split('\n')
    .map((range) => range.trim())
    .filter(Boolean);
  const ranges =
    explicitRanges.length > 0
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
  for (const path of untracked) {
    const content = readFileSync(path);
    if (content.includes(0)) continue;
    for (const [index, line] of content.toString('utf8').split(/\r?\n/).entries()) {
      if (/[ \t]+$/.test(line)) errors.push(`${path}:${index + 1}: trailing whitespace`);
      if (/^ +\t/.test(line)) errors.push(`${path}:${index + 1}: space before tab in indentation`);
    }
  }
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
} catch {
  process.exit(1);
}
