// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// QNBS-v3: the lightweight Node suite runs standalone locally and through required Vitest CI without importing its node:test runner into Vitest.
it('passes the standalone Pages pruning authority, retention, API and race regressions', () => {
  const path = fileURLToPath(new URL('./prunePagesDeployments.test.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', path], {
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(output).toContain('# fail 0');
});
