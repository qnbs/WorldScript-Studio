// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractJobBlock,
  extractJobNames,
  extractLocalPathDependencies,
  extractNeeds,
  extractRustClassifiers,
  extractStepBlock,
  resolveDependencyPrefix,
} from '../utils/workflowPolicyParsers';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));
const scheduledSecurityWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/security-scheduled.yml', import.meta.url),
);
const tauriManifestPath = fileURLToPath(new URL('../../src-tauri/Cargo.toml', import.meta.url));
const workflowSource = readFileSync(workflowPath, 'utf8');
const scheduledSecurityWorkflowSource = readFileSync(scheduledSecurityWorkflowPath, 'utf8');
const tauriManifestSource = readFileSync(tauriManifestPath, 'utf8');

// QNBS-v3: Keep CI path and deployment authority policy executable against the real workflow files.
describe('CI workflow policy', () => {
  // QNBS-v3: preserve first-attempt Vitest failures as visible CI evidence instead of masking flakes with retries.
  it('runs Vitest once so first-attempt failures cannot be hidden by retry', () => {
    const vitestRun = workflowSource.match(/run:\s*pnpm exec vitest run[^\n]*/)?.[0];
    expect(vitestRun).toBeDefined();
    expect(vitestRun).not.toContain('--retry');
  });

  // QNBS-v3: keep the shared CSP generator drift check in the authoritative cloud quality gate.
  it('runs the CSP generator drift check in the cloud quality gate', () => {
    expect(workflowSource).toContain('run: pnpm run csp:verify');
  });

  it('covers every local Tauri path dependency with the Tauri classifier', () => {
    const { tauri } = extractRustClassifiers(workflowSource);
    for (const dependencyPath of extractLocalPathDependencies(tauriManifestSource)) {
      const prefix = resolveDependencyPrefix(dependencyPath, tauriManifestPath, repositoryRoot);
      expect(
        tauri.test(`${prefix}__local_dependency_probe__`),
        `Tauri path dependency ${dependencyPath} resolves to ${prefix}, but ${workflowPath} does not classify that prefix`,
      ).toBe(true);
    }
  });

  it('classifies the representative changed-file sets correctly', () => {
    const { tauri, crates } = extractRustClassifiers(workflowSource);
    const cases = [
      ['src-tauri/src/lib.rs', true, false],
      ['crates/worldscript-project/src/validate.rs', true, true],
      ['crates/worldscript-project/Cargo.toml', true, true],
      ['crates/Cargo.lock', true, true],
      ['.github/workflows/ci.yml', true, true],
      ['components/App.tsx', false, false],
    ] as const;

    for (const [filePath, expectedTauri, expectedCrates] of cases) {
      expect(tauri.test(filePath), `${filePath} Tauri classification`).toBe(expectedTauri);
      expect(crates.test(filePath), `${filePath} Core classification`).toBe(expectedCrates);
    }
  });

  it('keeps deployment transitively downstream of ci-success', () => {
    const needsByJob = new Map(
      extractJobNames(workflowSource).map((jobName) => [
        jobName,
        extractNeeds(workflowSource, jobName),
      ]),
    );
    const visited = new Set<string>();
    const visit = (jobName: string): void => {
      if (visited.has(jobName)) return;
      visited.add(jobName);
      for (const dependency of needsByJob.get(jobName) ?? []) visit(dependency);
    };

    visit('deploy');
    expect(visited).toContain('ci-success');
  });

  // QNBS-v3: Keep every unconditional CI job explicitly required or advisory so deploy cannot false-green.
  it('keeps required and advisory job authority explicit', () => {
    const ciSuccessBlock = extractJobBlock(workflowSource, 'ci-success');
    expect(ciSuccessBlock).toContain(
      'Every unconditional job is either required here or explicitly advisory',
    );
    expect(extractNeeds(workflowSource, 'ci-success')).toEqual([
      'security',
      'quality',
      'changes',
      'rust-tauri',
      'core-rust',
      'build',
      'e2e',
      'lighthouse',
      'vrt',
    ]);
    expect(ciSuccessBlock).toMatch(/\$\{\{\s*needs\.lighthouse\.result\s*\}\}/);

    for (const jobName of ['e2e-deep', 'storybook']) {
      const jobBlock = extractJobBlock(workflowSource, jobName);
      expect(jobBlock).toMatch(/^ {4}continue-on-error: true$/m);
    }
  });

  // QNBS-v3: Keep unchanged-main vulnerability detection isolated, least-privilege, and fail-closed.
  it('keeps the scheduled OSV scan deterministic and actionable', () => {
    const scheduledJob = extractJobBlock(scheduledSecurityWorkflowSource, 'scheduled-osv');
    const scanStep = extractStepBlock(scheduledJob, 'Scan dependency lockfiles');
    const summaryStep = extractStepBlock(scheduledJob, 'Summarize OSV findings');
    const enforcementStep = extractStepBlock(scheduledJob, 'Enforce scheduled OSV result');

    expect(scheduledSecurityWorkflowSource).toMatch(
      /^on:\n {2}schedule:\n {4}- cron: '17 3 \* \* \*'\n {2}workflow_dispatch:\s*$/m,
    );
    expect(scheduledSecurityWorkflowSource).toMatch(/^permissions:\n {2}contents: read\s*$/m);
    expect(scheduledSecurityWorkflowSource).toContain(
      'concurrency:\n  group: scheduled-security-scan\n  cancel-in-progress: true',
    );
    expect(scheduledSecurityWorkflowSource).not.toMatch(/^\s*security-events:\s*write\s*$/m);
    expect(scanStep).toContain('id: osv');
    expect(scanStep).toContain('continue-on-error: true');
    expect(scanStep).toContain(
      'google/osv-scanner-action/osv-scanner-action@8deb546fdb875b9996d27d4950be7312dac076a1',
    );
    for (const lockfile of ['pnpm-lock.yaml', 'src-tauri/Cargo.lock', 'crates/Cargo.lock']) {
      expect(scanStep).toContain(`--lockfile=${lockfile}`);
    }
    expect(scanStep).toContain('--config=src-tauri/osv-scanner.toml');
    expect(scanStep).toContain('--format=json');
    expect(scanStep).toContain('--output-file=/github/workspace/osv-results.json');
    expect(summaryStep).toContain('GITHUB_STEP_SUMMARY');
    expect(enforcementStep).toContain('SCANNER_OUTCOME');
    expect(enforcementStep).toMatch(
      /if \[ "\$SCANNER_OUTCOME" != "success" \]; then[\s\S]+?exit 1\n\s+fi/,
    );
    expect(enforcementStep).toMatch(
      /if \[ ! -s \/github\/workspace\/osv-results\.json \]; then[\s\S]+?exit 1\n\s+fi/,
    );
  });
});
