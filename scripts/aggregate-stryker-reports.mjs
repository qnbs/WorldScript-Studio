import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutationModules, selectMutationModules } from './stryker-scope.mjs';

// QNBS-v3: Reject partial or inconsistent shard reports before aggregation can false-green.
const metricNames = [
  'pending',
  'ignored',
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
  if (value === undefined && ['pending', 'ignored'].includes(metricName)) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Stryker report has invalid metrics.${metricName}.`);
  }
  return value;
}

function deriveMetricsFromMutants(report, reportPath) {
  if (!report.files || typeof report.files !== 'object') {
    throw new Error(`Stryker report has neither metrics nor files: ${reportPath}`);
  }
  const statusCounts = Object.create(null);
  const knownStatuses = new Set([
    'CompileError',
    'Ignored',
    'Killed',
    'NoCoverage',
    'Pending',
    'RuntimeError',
    'Survived',
    'Timeout',
  ]);
  for (const file of Object.values(report.files)) {
    if (!file || !Array.isArray(file.mutants)) {
      throw new Error(`Stryker report has an invalid mutants list: ${reportPath}`);
    }
    for (const mutant of file.mutants) {
      if (!mutant || typeof mutant.status !== 'string' || !knownStatuses.has(mutant.status)) {
        throw new Error(`Stryker report has an unknown mutant status: ${reportPath}`);
      }
      statusCounts[mutant.status] = (statusCounts[mutant.status] ?? 0) + 1;
    }
  }
  const metrics = Object.fromEntries([
    ['pending', statusCounts.Pending ?? 0],
    ['ignored', statusCounts.Ignored ?? 0],
    ['killed', statusCounts.Killed ?? 0],
    ['survived', statusCounts.Survived ?? 0],
    ['timeout', statusCounts.Timeout ?? 0],
    ['noCoverage', statusCounts.NoCoverage ?? 0],
    ['runtimeErrors', statusCounts.RuntimeError ?? 0],
    ['compileErrors', statusCounts.CompileError ?? 0],
  ]);
  metrics.totalDetected = metrics.killed + metrics.timeout;
  metrics.totalUndetected = metrics.survived + metrics.noCoverage;
  metrics.totalCovered = metrics.totalDetected + metrics.survived;
  metrics.totalValid = metrics.totalDetected + metrics.totalUndetected;
  metrics.totalInvalid = metrics.runtimeErrors + metrics.compileErrors;
  metrics.totalMutants =
    metrics.totalValid + metrics.totalInvalid + metrics.ignored + metrics.pending;
  return metrics;
}

function readReportMetrics(report, reportPath) {
  if (report.metrics && typeof report.metrics === 'object') {
    return Object.fromEntries(metricNames.map((name) => [name, readMetric(report, name)]));
  }
  return deriveMetricsFromMutants(report, reportPath);
}

function validateMetricRelationships(metrics, reportPath) {
  const relationships = [
    ['totalDetected', metrics.killed + metrics.timeout],
    ['totalUndetected', metrics.survived + metrics.noCoverage],
    ['totalCovered', metrics.totalDetected + metrics.survived],
    ['totalValid', metrics.totalDetected + metrics.totalUndetected],
    ['totalInvalid', metrics.runtimeErrors + metrics.compileErrors],
    ['totalMutants', metrics.totalValid + metrics.totalInvalid + metrics.ignored + metrics.pending],
  ];
  for (const [name, expected] of relationships) {
    if (metrics[name] !== expected) {
      throw new Error(
        `Stryker report has inconsistent metrics.${name}: expected ${expected}, got ${metrics[name]} (${reportPath}).`,
      );
    }
  }
}

export function readStrykerReports(rootDirectory, selectedModules = mutationModules) {
  const reports = [];
  const missing = [];

  for (const module of selectedModules) {
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
    if (!report || typeof report !== 'object') {
      throw new Error(`Stryker report is not an object: ${reportPath}`);
    }
    const metrics = readReportMetrics(report, reportPath);
    validateMetricRelationships(metrics, reportPath);
    const score = metrics.totalValid > 0 ? (metrics.totalDetected / metrics.totalValid) * 100 : 0;
    reports.push({ name: module.name, metrics, mutationScore: score });
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Stryker reports: ${missing.join(', ')}`);
  }
  return reports;
}

export function aggregateStrykerReports(rootDirectory, selectedModules = mutationModules) {
  const reports = readStrykerReports(rootDirectory, selectedModules);
  const totals = Object.fromEntries(metricNames.map((name) => [name, 0]));
  for (const report of reports) {
    for (const name of metricNames) totals[name] += report.metrics[name];
  }
  const mutationScore =
    totals.totalValid > 0 ? (totals.totalDetected / totals.totalValid) * 100 : 0;
  return { reports, totals, mutationScore };
}

export function formatSummary(result) {
  const lines = [
    '## 🧬 Stryker Mutation Results',
    '',
    '| Module | Score | Killed | Survived | Timeout | No Cov | Ignored | Pending | Errors |',
    '|--------|------:|-------:|---------:|--------:|-------:|--------:|--------:|-------:|',
  ];
  for (const report of result.reports) {
    const { metrics } = report;
    const errors = metrics.runtimeErrors + metrics.compileErrors;
    lines.push(
      `| ${report.name} | ${report.mutationScore.toFixed(1)}% | ${metrics.killed} | ${metrics.survived} | ${metrics.timeout} | ${metrics.noCoverage} | ${metrics.ignored} | ${metrics.pending} | ${errors} |`,
    );
  }
  lines.push(
    `| **Total** | **${result.mutationScore.toFixed(1)}%** | **${result.totals.killed}** | **${result.totals.survived}** | **${result.totals.timeout}** | **${result.totals.noCoverage}** | **${result.totals.ignored}** | **${result.totals.pending}** | **${result.totals.runtimeErrors + result.totals.compileErrors}** |`,
    '',
    '> Every expected matrix shard produced a valid report; missing or invalid reports fail this job.',
  );
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = process.argv[2] ?? 'all-reports';
  const selectorIndex = process.argv.indexOf('--selector');
  const selectorValue = selectorIndex === -1 ? 'all' : process.argv[selectorIndex + 1];
  try {
    if (!selectorValue || selectorValue.startsWith('--')) {
      throw new Error('--selector requires a value: all, tier-a, or a module name.');
    }
    const result = aggregateStrykerReports(rootDirectory, selectMutationModules(selectorValue));
    const summary = formatSummary(result);
    process.stdout.write(summary);
  } catch (error) {
    console.error(`Stryker aggregation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
