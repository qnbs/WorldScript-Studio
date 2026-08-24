// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractActionReferences,
  extractTopLevelJobName,
  hasAggregateResultAssertion,
  isReleasePublishingCommand,
  isSemanticallyUnconditionalIf,
} from '../../scripts/workflow-policy-guards.mjs';
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
const tauriWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/tauri-build.yml', import.meta.url),
);
const intelWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/tauri-intel-qualification.yml', import.meta.url),
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
const intelWorkflowSource = readFileSync(intelWorkflowPath, 'utf8');
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
    const actionIndex = setupActionSource.indexOf('pnpm/action-setup@');
    const nodeIndex = setupActionSource.indexOf('actions/setup-node@');
    expect(setupActionSource).toContain(
      'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    );
    expect(setupActionSource).toContain(`version: ${expectedVersion}`);
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeLessThan(nodeIndex);
    expect(setupActionSource).not.toContain('corepack enable');
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
      'signatures',
      'quality',
      'changes',
      'rust-tauri',
      'core-rust',
      'build',
      'e2e',
      'lighthouse',
      'vrt',
    ]);
    expect(ciSuccessBlock).toMatch(/\$\{\{\s*needs\.signatures\.result\s*\}\}/);
    expect(ciSuccessBlock).toMatch(/\$\{\{\s*needs\.lighthouse\.result\s*\}\}/);
    // QNBS-v3: cover exact required and success-or-skipped aggregate semantics.
    for (const jobName of [
      'security',
      'signatures',
      'quality',
      'changes',
      'rust-tauri',
      'core-rust',
      'build',
      'e2e',
      'lighthouse',
      'vrt',
    ]) {
      const resultToken = `needs.${jobName}.result`;
      expect(ciSuccessBlock, `${jobName} result assertion`).toContain(resultToken);
      const assertionStart = ciSuccessBlock.indexOf(resultToken);
      expect(ciSuccessBlock.slice(assertionStart, assertionStart + 180)).toContain('FAIL=1');
      if (['rust-tauri', 'core-rust'].includes(jobName)) {
        expect(ciSuccessBlock).toMatch(new RegExp(`${resultToken}[^\\n]*!=\\s*["']success["']`));
        expect(ciSuccessBlock).toMatch(new RegExp(`${resultToken}[^\\n]*!=\\s*["']skipped["']`));
      } else {
        expect(ciSuccessBlock).toMatch(new RegExp(`${resultToken}[^\\n]*\\s=\\s*["']success["']`));
      }
    }

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
  it('normalizes quoted action references and whitespace before mapping colons', () => {
    const pinned = `actions/checkout@${'a'.repeat(40)}`;
    expect(extractActionReferences(`uses : "${pinned}"`)).toEqual([pinned]);
    expect(extractActionReferences(`- { uses : ${pinned} }`)).toEqual([pinned]);
    expect(extractActionReferences(`- "uses": ${pinned}`)).toEqual([pinned]);
  });

  it('normalizes quoted top-level job identifiers', () => {
    expect(extractTopLevelJobName('  "quoted-gate":')).toBe('quoted-gate');
    expect(extractTopLevelJobName("  'quoted-gate':")).toBe('quoted-gate');
    expect(extractTopLevelJobName('  ordinary-gate:')).toBe('ordinary-gate');
    expect(extractTopLevelJobName('    nested:')).toBe(null);
  });

  it('distinguishes semantically unconditional job conditions', () => {
    expect(isSemanticallyUnconditionalIf('    if: true')).toBe(true);
    expect(isSemanticallyUnconditionalIf('    if: $' + '{{ always() }}')).toBe(true);
    expect(isSemanticallyUnconditionalIf("    if: needs.changes.outputs.tauri == 'true'")).toBe(
      false,
    );
  });

  it('requires aggregate success checks to route failures through FAIL=1', () => {
    const needsBuild = '$' + '{{ needs.build.result }}';
    expect(
      hasAggregateResultAssertion(`[ "${needsBuild}" = "success" ] || FAIL=1`, 'build', false),
    ).toBe(true);
    expect(
      hasAggregateResultAssertion(`[ "${needsBuild}" = "success" ] && FAIL=1`, 'build', false),
    ).toBe(false);
  });

  // QNBS-v3: cover multiline and option-form release mutation detection.
  it('rejects mutating release commands in the non-publishing Intel workflow', () => {
    expect(isReleasePublishingCommand('    gh release create "$TAG"')).toBe(true);
    expect(isReleasePublishingCommand('    gh release upload "$TAG" artifact.dmg')).toBe(true);
    expect(
      isReleasePublishingCommand(
        '    curl --upload-file artifact.dmg https://uploads.github.com/repos/org/repo/releases/assets',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        '    curl --upload-file artifact.dmg \\\n          https://uploads.github.com/repos/org/repo/releases/assets',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        'curl --request DELETE https://api.github.com/repos/org/repo/releases/42',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        'curl --request=PATCH https://api.github.com/repos/org/repo/releases/42',
      ),
    ).toBe(true);
    expect(isReleasePublishingCommand('gh api --method DELETE /repos/org/repo/releases/42')).toBe(
      true,
    );
    expect(isReleasePublishingCommand('gh api --method=DELETE /repos/org/repo/releases/42')).toBe(
      true,
    );
    expect(isReleasePublishingCommand('gh api -X DELETE /repos/org/repo/assets/42')).toBe(true);
    expect(isReleasePublishingCommand('gh api /repos/org/repo/releases -f tag_name=v9')).toBe(true);
    expect(isReleasePublishingCommand('gh api /repos/org/repo/releases --field tag_name=v9')).toBe(
      true,
    );
    expect(isReleasePublishingCommand('gh api /repos/org/repo/releases --input release.json')).toBe(
      true,
    );
    expect(
      isReleasePublishingCommand(
        'curl --json @release.json https://api.github.com/repos/org/repo/releases',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        'wget --post-data=tag_name=v9 https://api.github.com/repos/org/repo/releases',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        'wget --post-file release.json --method POST https://api.github.com/repos/org/repo/releases',
      ),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(`run: >-
  gh release
  create "$TAG"`),
    ).toBe(true);
    expect(
      isReleasePublishingCommand(
        '          mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json',
      ),
    ).toBe(false);
  });

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

  it('does not continue qualification evidence uploads after cancellation', () => {
    const uploadStart = intelWorkflowSource.indexOf('name: Upload qualification evidence');
    const uploadBlock = intelWorkflowSource.slice(uploadStart, uploadStart + 500);
    expect(uploadBlock).toContain('if: $' + '{{ !cancelled() }}');
    expect(uploadBlock).not.toContain('if: always()');
  });
});
