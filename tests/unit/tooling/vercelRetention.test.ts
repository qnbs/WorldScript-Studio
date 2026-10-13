// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// QNBS-v3: the lightweight Node suite runs standalone locally and through required Vitest CI without importing its node:test runner into Vitest.
it('passes the standalone Vercel retention authority, classification, mutation and entry-point regressions', () => {
  const path = fileURLToPath(new URL('./vercelRetention.test.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', path], {
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(output).toContain('# fail 0');
});
