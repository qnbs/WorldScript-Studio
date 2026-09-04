// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractJobBlock,
  extractJobIf,
  extractJobNames,
  extractLocalPathDependencies,
  extractNeeds,
  extractRustClassifiers,
  extractStepBlock,
  resolveDependencyPrefix,
} from '../utils/workflowPolicyParsers';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));
const tauriWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/tauri-build.yml', import.meta.url),
);
const setupActionPath = fileURLToPath(
  new URL('../../.github/actions/setup/action.yml', import.meta.url),
);
const cloudflareWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/deploy-cloudflare-pages.yml.disabled', import.meta.url),
);
const scheduledSecurityWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/security-scheduled.yml', import.meta.url),
);
const tauriManifestPath = fileURLToPath(new URL('../../src-tauri/Cargo.toml', import.meta.url));
const workflowSource = readFileSync(workflowPath, 'utf8');
const tauriWorkflowSource = readFileSync(tauriWorkflowPath, 'utf8');
const setupActionSource = readFileSync(setupActionPath, 'utf8');
const cloudflareWorkflowSource = readFileSync(cloudflareWorkflowPath, 'utf8');
const scheduledSecurityWorkflowSource = readFileSync(scheduledSecurityWorkflowPath, 'utf8');
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as {
  packageManager: string;
};
const tauriManifestSource = readFileSync(tauriManifestPath, 'utf8');

// QNBS-v3: Keep CI path and deployment authority policy executable against the real workflow files.
describe('CI workflow policy', () => {
  // QNBS-v3: the first package-manager binary must be patched and explicit before repository caching/install.
  it('bootstraps the exact secure pnpm before setup-node cache or install', () => {
    const expectedVersion = packageJson.packageManager.replace('pnpm@', '');
    const actionIndex = setupActionSource.indexOf('pnpm/setup@');
    const nodeIndex = setupActionSource.indexOf('actions/setup-node@');
    expect(setupActionSource).toContain('pnpm/setup@703c52620218391530e48b9e8870d5c0082e1b9b');
    expect(setupActionSource).toContain(`version: ${expectedVersion}`);
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeLessThan(nodeIndex);
    expect(setupActionSource).not.toContain('corepack enable');
    // QNBS-v3: retired bootstrap must not silently reappear alongside the new one.
    expect(setupActionSource).not.toContain('pnpm/action-setup@');
    // QNBS-v3: install:false keeps the explicit "pnpm install --frozen-lockfile" step as the sole install call and its failure attribution.
    expect(setupActionSource).toContain('install: false');
    const setupToolchainIndex = setupActionSource.indexOf(
      'export npm_config_user_agent="pnpm/$(pnpm --version)"',
    );
    const setupInstallIndex = setupActionSource.indexOf('pnpm install --frozen-lockfile');
    expect(setupToolchainIndex).toBeGreaterThanOrEqual(0);
    expect(setupToolchainIndex).toBeLessThan(setupInstallIndex);

    const cloudflareToolchainIndex = cloudflareWorkflowSource.indexOf(
      'export npm_config_user_agent="pnpm/$(pnpm --version)"',
    );
    const cloudflareInstallIndex = cloudflareWorkflowSource.indexOf(
      'pnpm install --frozen-lockfile',
    );
    expect(cloudflareToolchainIndex).toBeGreaterThanOrEqual(0);
    expect(cloudflareToolchainIndex).toBeLessThan(cloudflareInstallIndex);
  });
  // QNBS-v3: this job predates the trust boundary it validates, so it duplicates the composite's pnpm bootstrap instead of using it — verify that duplicate independently.
  it('bootstraps the exact secure pnpm in the workflow-policy job itself, before the gate it validates', () => {
    const expectedVersion = packageJson.packageManager.replace('pnpm@', '');
    const policyBlock = extractJobBlock(workflowSource, 'workflow-policy');
    const actionIndex = policyBlock.indexOf('pnpm/setup@');
    const nodeIndex = policyBlock.indexOf('actions/setup-node@');
    expect(policyBlock).toContain('pnpm/setup@703c52620218391530e48b9e8870d5c0082e1b9b');
    expect(policyBlock).toContain(`version: ${expectedVersion}`);
    expect(policyBlock).toContain('install: false');
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeLessThan(nodeIndex);
    expect(policyBlock).not.toContain('pnpm/action-setup@');
    expect(policyBlock).not.toContain('corepack enable');
    // QNBS-v3: the pnpm/setup swap must not weaken this job's no-lifecycle-scripts install hardening.
    expect(policyBlock).toContain(
      'pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
    );
  });
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

  // QNBS-v3 (#522): deploy's default success() gate inherits skip-propagation from pr-size/rust-tauri/core-rust being legitimately skipped on push, even though ci-success itself computed 'success' — always() overrides that and makes ci-success.result the real gate.
  it('gates deploy on ci-success.result explicitly via always()+!cancelled(), not implicit success()', () => {
    const deployBlock = extractJobBlock(workflowSource, 'deploy');
    const deployIf = extractJobIf(deployBlock);
    expect(extractNeeds(workflowSource, 'deploy')).toEqual(['ci-success']);
    // QNBS-v3 (#522): main push has pr-size/rust-tauri/core-rust legitimately skipped and ci-success == success — deploy must still be eligible, not silently skipped by GHA's default chain propagation.
    expect(deployIf).toContain('always()');
    expect(deployIf).toContain('!cancelled()');
    expect(deployIf).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(deployIf).toMatch(/github\.event_name != 'pull_request'/);
    expect(deployIf).toMatch(/needs\.ci-success\.result == 'success'/);
    expect(deployIf).toMatch(
      /always\(\)[\s\S]+!cancelled\(\)[\s\S]+github\.ref == 'refs\/heads\/main'[\s\S]+github\.event_name != 'pull_request'[\s\S]+needs\.ci-success\.result == 'success'/,
    );
  });

  // QNBS-v3: Keep every unconditional CI job explicitly required or advisory so deploy cannot false-green.
  it('keeps required and advisory job authority explicit', () => {
    const ciSuccessBlock = extractJobBlock(workflowSource, 'ci-success');
    expect(ciSuccessBlock).toContain(
      'Every unconditional job is either required here or explicitly advisory',
    );
    expect(extractNeeds(workflowSource, 'ci-success')).toEqual([
      'workflow-policy',
      'pr-size',
      'security',
      'signatures',
      'quality',
      'changes',
      'rust-tauri',
      'core-rust',
      'build',
      'e2e',
      'browser-quality',
    ]);
    expect(ciSuccessBlock).toMatch(/\$\{\{\s*needs\.signatures\.result\s*\}\}/);
    expect(ciSuccessBlock).toMatch(/\$\{\{\s*needs\.browser-quality\.result\s*\}\}/);

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
      'google/osv-scanner-action/osv-scanner-action@6e4298ebc4db23e847df9b2e2de2939d6f066c67',
    );
    for (const lockfile of ['pnpm-lock.yaml', 'src-tauri/Cargo.lock', 'crates/Cargo.lock']) {
      expect(scanStep).toContain(`--lockfile=${lockfile}`);
    }
    expect(scanStep).toContain('--config=src-tauri/osv-scanner.toml');
    expect(scanStep).toContain('--format=json');
    expect(scanStep).toContain('--output-file=osv-results.json');
    expect(summaryStep).toContain('GITHUB_STEP_SUMMARY');
    expect(summaryStep).toContain('process.env.GITHUB_WORKSPACE');
    expect(enforcementStep).toContain('SCANNER_OUTCOME');
    expect(enforcementStep).toMatch(
      /if \[ "\$SCANNER_OUTCOME" != "success" \]; then[\s\S]+?exit 1\n\s+fi/,
    );
    expect(enforcementStep).toMatch(
      /if \[ ! -s "\$GITHUB_WORKSPACE\/osv-results\.json" \]; then[\s\S]+?exit 1\n\s+fi/,
    );
  });
});

// QNBS-v3: keep desktop publication causally downstream of independently verified annotated tags.
describe('Tauri release workflow policy', () => {
  it('runs the signature verifier only for real version-tag pushes with read-only access', () => {
    const verifier = extractJobBlock(tauriWorkflowSource, 'verify-release-tag');
    expect(verifier).toMatch(
      /^ {4}if: >-\n {6}\$\{\{ github\.event_name == 'push' && github\.ref_type == 'tag' && startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}$/m,
    );
    expect(verifier).toContain('scripts/signing/verify-github-signatures.mjs');
    expect(verifier).toMatch(/^ {4}permissions:\n {6}contents: read\s*$/m);
    expect(verifier).not.toContain('workflow_dispatch');
  });

  it('requires successful tag verification before tagged bundles, while allowing manual builds', () => {
    const bundle = extractJobBlock(tauriWorkflowSource, 'bundle');
    expect(extractNeeds(tauriWorkflowSource, 'bundle')).toEqual(['verify-release-tag']);
    expect(bundle).toContain('always()');
    expect(bundle).toContain('!cancelled()');
    expect(bundle).toMatch(/github\.event_name == 'workflow_dispatch'/);
    expect(bundle).toMatch(/needs\.verify-release-tag\.result == 'success'/);
    expect(bundle).toMatch(
      /always\(\)\s*&&\s*!cancelled\(\)[\s\S]+github\.event_name == 'workflow_dispatch'[\s\S]+needs\.verify-release-tag\.result == 'success'/,
    );
    expect(bundle).toContain('Skip updater signing for workflow_dispatch test builds');
  });

  it('keeps release publication tag-only and downstream of bundle output', () => {
    const release = extractJobBlock(tauriWorkflowSource, 'release');
    expect(extractNeeds(tauriWorkflowSource, 'release')).toEqual(['bundle']);
    expect(release).toMatch(
      /^ {4}if: >-\n {6}\$\{\{ github\.event_name == 'push' && github\.ref_type == 'tag' && startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}$/m,
    );
    expect(release).not.toContain('workflow_dispatch');
    expect(release).toContain('body_path: release-notes.md');
    expect(release).toContain('generate_release_notes: false');
    expect(release).toContain('Check out the exact release tag');
    expect(release).toContain('Release notes claim #332 or #341 closure');
    expect(release).toContain('index($0, "## [" version "] — ")');
    expect(release).not.toContain('2026-08-23');
  });

  it('preserves the authoritative CI Success status gate', () => {
    const ciSuccess = extractJobBlock(workflowSource, 'ci-success');
    expect(ciSuccess).toContain('✅ CI Success');
    expect(workflowSource).toContain('name: ✅ CI Success');
  });

  // QNBS-v3: codecov/test-results-action is deprecated upstream in favor of the main codecov-action; guard against it creeping back in.
  it('never uses the deprecated codecov/test-results-action', () => {
    expect(workflowSource).not.toContain('test-results-action');
  });

  // QNBS-v3: one upload per test suite (unit x1 source occurrence covers both matrix legs, e2e, e2e-deep, storybook, vrt) — a sixth occurrence would mean an untracked/duplicate upload.
  it('publishes test analytics for every suite with report_type: test_results, disable_search, and !cancelled()', () => {
    const reportTypeCount = (workflowSource.match(/report_type: test_results/g) ?? []).length;
    expect(reportTypeCount).toBe(5);
    const disableSearchCount = (workflowSource.match(/disable_search: true/g) ?? []).length;
    expect(disableSearchCount).toBe(reportTypeCount);
    // QNBS-v3: a real test failure must still upload — default success() would hide it.
    const cancelledGuardCount = (
      workflowSource.match(/if: \$\{\{ !cancelled\(\) \}\}\n\s+uses: codecov\/codecov-action/g) ??
      []
    ).length;
    expect(cancelledGuardCount).toBe(reportTypeCount);
  });

  // QNBS-v3: the aggregate count above cannot tell five correct uploads from five miswired duplicates of one suite — assert each suite's own exact upload.
  it.each([
    {
      job: 'quality',
      step: 'Publish unit test results to Codecov',
      files: 'reports/junit.xml',
      flags: `unit-node\${{ matrix.node-version }}`,
      name: `unit-node\${{ matrix.node-version }}`,
    },
    {
      job: 'e2e',
      step: 'Publish E2E test results to Codecov',
      files: 'tests/e2e/results/junit.xml',
      flags: 'e2e',
      name: 'playwright-e2e',
    },
    {
      job: 'e2e-deep',
      step: 'Publish deep E2E test results to Codecov',
      files: 'tests/e2e/results/junit.xml',
      flags: 'e2e-deep',
      name: 'e2e-deep',
    },
    {
      job: 'storybook',
      step: 'Publish Storybook test results to Codecov',
      files: 'test-results/storybook-junit.xml',
      flags: 'storybook',
      name: 'storybook',
    },
    {
      job: 'browser-quality',
      step: 'Publish VRT test results to Codecov',
      files: 'tests/e2e/results/junit.xml',
      flags: 'vrt',
      name: 'vrt',
    },
  ])(
    '$job uploads its own test analytics with the correct files/flags/name',
    ({ job, step, files, flags, name }) => {
      const jobBlock = extractJobBlock(workflowSource, job);
      const uploadStep = extractStepBlock(jobBlock, step);
      expect(uploadStep).toContain(
        'uses: codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f',
      );
      expect(uploadStep).toContain(`if: \${{ !cancelled() }}`);
      expect(uploadStep).toContain('report_type: test_results');
      expect(uploadStep).toContain('disable_search: true');
      expect(uploadStep).toContain(`files: ${files}`);
      expect(uploadStep).toContain(`flags: ${flags}`);
      expect(uploadStep).toContain(`name: ${name}`);
    },
  );

  // QNBS-v3: a workflow/job-wide token would reach every step, including ones that never need it.
  it('never assigns CODECOV_TOKEN at workflow or job level, only inside individual steps', () => {
    expect(workflowSource).not.toMatch(/^env:\n(?:.*\n)*?\s*CODECOV_TOKEN/m);
    for (const jobName of extractJobNames(workflowSource)) {
      const jobBlock = extractJobBlock(workflowSource, jobName);
      const jobLevelEnv = jobBlock.match(/^ {4}env:\n([\s\S]*?)(?=\n {4}\S|\n {2}\S|$)/m)?.[1];
      if (jobLevelEnv) expect(jobLevelEnv).not.toContain('CODECOV_TOKEN');
    }
  });

  // QNBS-v3: a second test run just to get JUnit would double Vitest's cost for no new coverage.
  it('runs Vitest once with both JSON and JUnit reporters at explicit paths, still without retry', () => {
    const qualityBlock = extractJobBlock(workflowSource, 'quality');
    const vitestStep = extractStepBlock(qualityBlock, 'Unit tests (Vitest, no retry)');
    expect(vitestStep).toContain('--reporter=json');
    expect(vitestStep).toContain('--reporter=junit');
    // QNBS-v3: explicit paths for both reporters — never relying on vitest.config.ts's own reporter-tuple default drifting independently of this exact command.
    expect(vitestStep).toContain('--outputFile.json=test-results.json');
    expect(vitestStep).toContain('--outputFile.junit=reports/junit.xml');
    expect(vitestStep).not.toContain('--retry');
    expect((qualityBlock.match(/pnpm exec vitest run/g) ?? []).length).toBe(1);
  });

  // QNBS-v3: an always-on flag would upload from local `pnpm run build` too, not just the intended CI analysis pass.
  it('scopes Codecov Bundle Analysis to the analysis-build step only, never the plain build step', () => {
    const buildBlock = extractJobBlock(workflowSource, 'build');
    const plainBuildStep = extractStepBlock(buildBlock, 'Build application');
    const analysisStep = extractStepBlock(
      buildBlock,
      'Bundle analysis (rollup visualizer + Codecov)',
    );
    expect(plainBuildStep).not.toContain('CODECOV_BUNDLE_ANALYSIS');
    expect(plainBuildStep).not.toContain('CODECOV_TOKEN');
    expect(analysisStep).toContain("CODECOV_BUNDLE_ANALYSIS: 'true'");
    expect(analysisStep).toContain(`CODECOV_TOKEN: \${{ secrets.CODECOV_TOKEN }}`);
    // QNBS-v3: exactly one analyze/build invocation in this job — a second `vite build` would defeat the point of reusing the existing ANALYZE pass.
    expect((buildBlock.match(/run: pnpm run (build|analyze)\n/g) ?? []).length).toBe(2);
  });
});
