// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('passes the standalone Vercel deployment-record retention regressions', () => {
  const path = fileURLToPath(new URL('./pruneVercelDeploymentRecords.test.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', path], {
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(output).toContain('# fail 0');
});
