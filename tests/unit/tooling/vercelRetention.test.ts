// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// QNBS-v3: the lightweight Node suite runs standalone locally and through required Vitest CI without importing its node:test runner into Vitest.
it('passes the standalone Vercel retention authority, classification, mutation, lock, entry-point and runtime regressions', () => {
  const paths = [
    './vercelRetention.test.mjs',
    './vercelRetentionSafety.test.mjs',
    './vercelRetentionRuntime.test.mjs',
  ].map((name) => fileURLToPath(new URL(name, import.meta.url)));
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...paths], {
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(output).toContain('# fail 0');
});
