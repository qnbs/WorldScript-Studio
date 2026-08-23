import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectTrackedSourceFiles,
  scanSuppressionFiles,
  scanSuppressionText,
} from '../../../scripts/suppression-scanner.mjs';

// QNBS-v3: Inject tracked-file output so copied or untracked worktrees cannot inflate the ratchet.
describe('suppression scanner', () => {
  const marker = ['biome', 'ignore'].join('-');

  it('counts directives by rule without depending on the checkout tree', () => {
    const result = scanSuppressionText(
      `// ${marker} lint/suspicious/noExplicitAny: test fixture\n// ${marker} lint/a11y/useSemanticElements: test fixture\n`,
    );

    expect(result).toEqual({
      total: 2,
      byRule: {
        'lint/suspicious/noExplicitAny': 1,
        'lint/a11y/useSemanticElements': 1,
      },
    });
  });

  it('counts only the files supplied by the tracked-file collector', () => {
    const root = process.cwd();
    const trackedFile = join(root, 'App.tsx');

    const files = collectTrackedSourceFiles({
      root,
      listTrackedFiles: () => 'App.tsx\0',
    });

    expect(files).toEqual([trackedFile]);
    expect(
      scanSuppressionFiles(files, () => `// ${marker} lint/suspicious/noExplicitAny: tracked\n`),
    ).toMatchObject({
      total: 1,
      byRule: { 'lint/suspicious/noExplicitAny': 1 },
    });
  });

  it('ignores untracked recovery copies and arbitrary untracked source', () => {
    const root = process.cwd();
    const trackedFile = join(root, 'App.tsx');

    const files = collectTrackedSourceFiles({
      root,
      listTrackedFiles: () => 'App.tsx\0',
    });

    expect(files).toEqual([trackedFile]);
    expect(files.some((file) => file.includes('.worktrees'))).toBe(false);
    expect(files.some((file) => file.includes('recovery-artifacts'))).toBe(false);
    expect(files.some((file) => file.includes('arbitrary-copy'))).toBe(false);
  });
});
