// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateStrykerReports,
  formatSummary,
} from '../../../scripts/aggregate-stryker-reports.mjs';

const temporaryRoots: string[] = [];

// QNBS-v3: Exercise fail-closed aggregation and preserve actionable mutation metrics.
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
    pending: 0,
    ignored: 0,
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
      killed: 8,
      noCoverage: 2,
      timeout: 3,
      totalUndetected: 3,
      totalDetected: 11,
      totalCovered: 12,
      totalValid: 14,
      totalMutants: 14,
    });
    const result = aggregateStrykerReports(root);
    expect(result.totals.noCoverage).toBe(2);
    expect(result.totals.timeout).toBe(10);
    expect(formatSummary(result)).toContain('No Cov');
    expect(formatSummary(result)).toContain('Total');
  });

  it('aggregates only the validated all, tier-a, or named module selection', async () => {
    const root = createReportRoot();
    const { mutationModules, selectMutationModules } = await import(
      '../../../scripts/stryker-scope.mjs'
    );
    for (const module of mutationModules) writeReport(root, module.name);

    for (const selector of ['all', 'tier-a', 'services-commands']) {
      const selectedModules = selectMutationModules(selector);
      const result = aggregateStrykerReports(root, selectedModules);
      expect(result.reports).toHaveLength(selectedModules.length);
    }
  });

  it('rejects inconsistent Stryker metrics instead of trusting report scores', async () => {
    const root = createReportRoot();
    const { mutationModules } = await import('../../../scripts/stryker-scope.mjs');
    for (const module of mutationModules) writeReport(root, module.name);
    writeReport(root, 'services-commands', { totalDetected: 8 });

    expect(() => aggregateStrykerReports(root)).toThrow('inconsistent metrics.totalDetected');
  });

  it('uses a zero score when a report contains no valid mutants', async () => {
    const root = createReportRoot();
    const { selectMutationModules } = await import('../../../scripts/stryker-scope.mjs');
    const selectedModules = selectMutationModules('services-commands');
    writeReport(root, 'services-commands', {
      killed: 0,
      survived: 0,
      timeout: 0,
      noCoverage: 0,
      totalDetected: 0,
      totalUndetected: 0,
      totalCovered: 0,
      totalValid: 0,
      totalInvalid: 0,
      totalMutants: 0,
    });

    expect(aggregateStrykerReports(root, selectedModules).mutationScore).toBe(0);
  });

  it('derives canonical metrics from Stryker mutant statuses', async () => {
    const root = createReportRoot();
    const reportDirectory = join(root, 'stryker-report-services-commands');
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(
      join(reportDirectory, 'mutation.json'),
      JSON.stringify({
        files: {
          'services/commands/example.ts': {
            mutants: [
              { status: 'Killed' },
              { status: 'Timeout' },
              { status: 'Survived' },
              { status: 'NoCoverage' },
              { status: 'RuntimeError' },
              { status: 'CompileError' },
              { status: 'Ignored' },
              { status: 'Pending' },
            ],
          },
        },
      }),
    );
    const { selectMutationModules } = await import('../../../scripts/stryker-scope.mjs');
    const result = aggregateStrykerReports(root, selectMutationModules('services-commands'));

    const report = result.reports[0];
    expect(report).toBeDefined();
    if (!report) throw new Error('Expected one services-commands report.');
    expect(report.metrics).toMatchObject({
      killed: 1,
      timeout: 1,
      survived: 1,
      noCoverage: 1,
      runtimeErrors: 1,
      compileErrors: 1,
      ignored: 1,
      pending: 1,
      totalValid: 4,
      totalInvalid: 2,
      totalMutants: 8,
    });
    expect(result.mutationScore).toBe(50);
  });
});
