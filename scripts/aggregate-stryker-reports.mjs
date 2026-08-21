import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutationModules } from './stryker-scope.mjs';

const metricNames = [
  'killed',
  'survived',
  'timeout',
  'noCoverage',
  'runtimeErrors',
  'compileErrors',
  'totalDetected',
  'totalUndetected',
  'totalCovered',
  'totalValid',
  'totalInvalid',
  'totalMutants',
];

function readMetric(report, metricName) {
  const value = report.metrics?.[metricName];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Stryker report has invalid metrics.${metricName}.`);
  }
  return value;
}

export function readStrykerReports(rootDirectory) {
  const reports = [];
  const missing = [];

  for (const module of mutationModules) {
    const reportPath = path.join(rootDirectory, `stryker-report-${module.name}`, 'mutation.json');
    if (!existsSync(reportPath)) {
      missing.push(`${module.name}/mutation.json`);
      continue;
    }
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot parse ${reportPath}: ${error.message}`);
    }
    if (!report || typeof report.metrics !== 'object') {
      throw new Error(`Stryker report has no metrics object: ${reportPath}`);
    }
    const metrics = Object.fromEntries(metricNames.map((name) => [name, readMetric(report, name)]));
    const score = report.metrics.mutationScore;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`Stryker report has no finite mutation score: ${reportPath}`);
    }
    reports.push({ name: module.name, metrics, mutationScore: score });
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Stryker reports: ${missing.join(', ')}`);
  }
  return reports;
}

export function aggregateStrykerReports(rootDirectory) {
  const reports = readStrykerReports(rootDirectory);
  const totals = Object.fromEntries(metricNames.map((name) => [name, 0]));
  for (const report of reports) {
    for (const name of metricNames) totals[name] += report.metrics[name];
  }
  const mutationScore =
    totals.totalValid > 0 ? (totals.totalDetected / totals.totalValid) * 100 : 100;
  return { reports, totals, mutationScore };
}

export function formatSummary(result) {
  const lines = [
    '## 🧬 Stryker Mutation Results',
    '',
    '| Module | Score | Killed | Survived | Timeout | No Cov | Errors |',
    '|--------|------:|-------:|---------:|--------:|-------:|-------:|',
  ];
  for (const report of result.reports) {
    const { metrics } = report;
    const errors = metrics.runtimeErrors + metrics.compileErrors;
    lines.push(
      `| ${report.name} | ${report.mutationScore.toFixed(1)}% | ${metrics.killed} | ${metrics.survived} | ${metrics.timeout} | ${metrics.noCoverage} | ${errors} |`,
    );
  }
  lines.push(
    `| **Total** | **${result.mutationScore.toFixed(1)}%** | **${result.totals.killed}** | **${result.totals.survived}** | **${result.totals.timeout}** | **${result.totals.noCoverage}** | **${result.totals.runtimeErrors + result.totals.compileErrors}** |`,
    '',
    '> Every expected matrix shard produced a valid report; missing or invalid reports fail this job.',
  );
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = process.argv[2] ?? 'all-reports';
  try {
    const result = aggregateStrykerReports(rootDirectory);
    const summary = formatSummary(result);
    process.stdout.write(summary);
  } catch (error) {
    console.error(`Stryker aggregation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
