// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkUntrackedFile } from '../../../scripts/check-git-diff.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

// QNBS-v3: keep untracked-file diff diagnostics aligned with Git's EOF whitespace semantics.
describe('untracked diff integrity', () => {
  it.each([
    ['text with one terminating newline', 'content\n', false],
    ['text with an extra blank line at EOF', 'content\n\n', true],
    ['CRLF line ending matches git whitespace policy', 'content\r\nnext\r\n', true],
    ['conflict marker is diagnosed', '<<<<<<< HEAD\nclean content\n=======\n', true],
  ])('%s', (_label, content, shouldFail) => {
    const directory = mkdtempSync(join(repositoryRoot, '.tmp-check-git-diff-'));
    try {
      const filePath = join(directory, 'sample.txt');
      writeFileSync(filePath, content);
      const diagnostics = checkUntrackedFile(filePath);
      expect(diagnostics.length > 0).toBe(shouldFail);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
