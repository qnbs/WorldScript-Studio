// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateStrykerReports,
  formatSummary,
} from '../../../scripts/aggregate-stryker-reports.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createReportRoot() {
  const root = mkdtempSync(join(process.cwd(), '.stryker-report-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeReport(root: string, moduleName: string, overrides: Record<string, number> = {}) {
  const metrics = {
    killed: 8,
    survived: 1,
    timeout: 1,
    noCoverage: 0,
    runtimeErrors: 0,
    compileErrors: 0,
    totalDetected: 9,
    totalUndetected: 1,
    totalCovered: 10,
    totalValid: 10,
    totalInvalid: 0,
    totalMutants: 10,
    ...overrides,
  };
  const reportDirectory = join(root, `stryker-report-${moduleName}`);
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    join(reportDirectory, 'mutation.json'),
    JSON.stringify({
      metrics: { ...metrics, mutationScore: (metrics.totalDetected / metrics.totalValid) * 100 },
    }),
  );
}

describe('Stryker report aggregation', () => {
  it('requires every authoritative scope module', async () => {
    const root = createReportRoot();
    writeReport(root, 'services-commands');
    await expect(
      import('../../../scripts/aggregate-stryker-reports.mjs').then(({ aggregateStrykerReports }) =>
        aggregateStrykerReports(root),
      ),
    ).rejects.toThrow('Missing required Stryker reports');
  });

  it('preserves no-coverage and timeout metrics in the weighted summary', async () => {
    const root = createReportRoot();
    const { mutationModules } = await import('../../../scripts/stryker-scope.mjs');
    for (const module of mutationModules) writeReport(root, module.name);
    writeReport(root, 'services-commands', {
      noCoverage: 2,
      timeout: 3,
      totalUndetected: 3,
      totalCovered: 10,
      totalValid: 12,
    });
    const result = aggregateStrykerReports(root);
    expect(result.totals.noCoverage).toBe(2);
    expect(result.totals.timeout).toBe(10);
    expect(formatSummary(result)).toContain('No Cov');
    expect(formatSummary(result)).toContain('Total');
  });
});
