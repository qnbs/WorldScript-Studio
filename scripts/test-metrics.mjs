import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/;

function collectTestSources(directory, repositoryRoot, sources) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path === join(repositoryRoot, 'tests', 'e2e')) continue;
      collectTestSources(path, repositoryRoot, sources);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      sources.push(path);
    }
  }
}

// QNBS-v3: one traversal contract keeps README synchronization and doc validation on identical Vitest roots and exclusions.
export function getVitestTestSources(repositoryRoot = DEFAULT_ROOT) {
  const sources = [];
  for (const directory of ['tests', 'components']) {
    collectTestSources(join(repositoryRoot, directory), repositoryRoot, sources);
  }
  const packagesRoot = join(repositoryRoot, 'packages');
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (entry.isDirectory())
      collectTestSources(join(packagesRoot, entry.name, 'tests'), repositoryRoot, sources);
  }
  return sources;
}

export function getVitestTestFileCount(repositoryRoot = DEFAULT_ROOT) {
  return getVitestTestSources(repositoryRoot).length;
}

export function getVitestTestCaseCount(repositoryRoot = DEFAULT_ROOT) {
  return getVitestTestSources(repositoryRoot).reduce((count, path) => {
    const source = readFileSync(path, 'utf8');
    return count + (source.match(/\b(?:it|test)\s*\(/g)?.length ?? 0);
  }, 0);
}
