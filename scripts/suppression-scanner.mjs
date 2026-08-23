import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SRC_EXTENSIONS = new Set(['.ts', '.tsx']);
export const BIOME_IGNORE = /biome-ignore(?:-start|-end)?\s+([a-zA-Z][\w/]*)/;

/**
 * Return the source paths Git considers tracked.
 *
 * Keeping the Git invocation injectable makes the scan universe deterministic in tests and,
 * more importantly, prevents copied checkout descendants from becoming first-party source.
 */
export function collectTrackedSourceFiles({
  root,
  listTrackedFiles = listTrackedFilesFromGit,
} = {}) {
  const projectRoot = root ?? process.cwd();
  const output = listTrackedFiles(projectRoot);
  const trackedPaths = output.split('\0').filter(Boolean);

  return trackedPaths
    .filter((relativePath) => SRC_EXTENSIONS.has(path.extname(relativePath)))
    .map((relativePath) => path.resolve(projectRoot, relativePath))
    .filter((absolutePath) => fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile());
}

function listTrackedFilesFromGit(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.ts', '*.tsx'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function scanSuppressionText(text) {
  /** @type {Record<string, number>} */
  const byRule = {};
  let total = 0;

  for (const line of text.split('\n')) {
    if (!line.includes('biome-ignore')) continue;
    const match = line.match(BIOME_IGNORE);
    const rule = match ? match[1] : 'unknown';
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    total++;
  }

  return { total, byRule };
}

export function scanSuppressionFiles(files, readFile = (file) => fs.readFileSync(file, 'utf8')) {
  /** @type {Record<string, number>} */
  const byRule = {};
  /** @type {Record<string, Record<string, number>>} */
  const byFile = {};
  let total = 0;

  for (const file of files) {
    const result = scanSuppressionText(readFile(file));
    if (result.total === 0) continue;

    total += result.total;
    for (const [rule, count] of Object.entries(result.byRule)) {
      byRule[rule] = (byRule[rule] ?? 0) + count;
    }
    byFile[file] = result.byRule;
  }

  const sorted = Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1]));
  return { total, byRule: sorted, byFile };
}
