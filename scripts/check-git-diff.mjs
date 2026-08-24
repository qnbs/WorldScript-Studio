import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

try {
  const diff = spawnSync('git', ['diff', '--check', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (diff.status !== 0) process.exit(1);

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
