// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const policyPath = fileURLToPath(
  new URL('../../docs/VERCEL-PREVIEW-RETENTION-POLICY.md', import.meta.url),
);
// QNBS-v3: collapse Markdown wraps so the checker binds phrases, not physical line breaks.
function prose(source: string): string {
  return source.replace(/\s+/g, ' ');
}

const policy = prose(readFileSync(policyPath, 'utf8'));

const companionPaths = [
  '../../AGENTS.md',
  '../../docs/PR-CI-MERGE-WORKFLOW.md',
  '../../docs/DEPLOYMENT.md',
  '../../docs/CURSOR-CLOUD-AGENT.md',
] as const;

const DEFERRED_HOUSEKEEPING = [
  'full authenticated Vercel deployment inventory',
  'dry-run SAFE/PROTECTED/UNKNOWN classification',
  'stale Preview deletion',
  'retired Preview branch-alias cleanup',
  'newest-three-per-open-PR Preview snapshot',
  'retention-specific rollback-history re-enumeration',
] as const;

describe('Vercel retention train deferral', () => {
  it('keeps ordinary mode as full retention after every successful merge', () => {
    expect(policy).toContain('After every successful merge to `main`');
    expect(policy).toContain('This lifecycle is **NORMAL MODE**.');
    expect(policy).toContain(
      'Dependent repository mutation waits for the full reconciliation above.',
    );
    expect(policy).toContain('perform the dry-run classification and bounded cleanup');
  });

  it('defers only listed Preview housekeeping inside an explicit train', () => {
    expect(policy).toContain('TRAIN_KIND = dependency/toolchain maintenance');
    expect(policy).toContain('TRAIN_OWNER = one named writer');
    expect(policy).toContain('START_BASELINE_RETENTION = terminal');
    expect(policy).toContain('UNRELATED_FEATURE_MERGES = forbidden');
    expect(policy).toContain('PRODUCTION_AUTHORITY_SWITCH = forbidden');
    expect(policy).toContain('do not perform destructive Vercel retention mutation');
    for (const item of DEFERRED_HOUSEKEEPING) {
      expect(policy).toContain(item);
    }
    expect(policy).toContain('Vercel Production is `READY` on that exact SHA');
    expect(policy).toContain('canonical Production HTTP succeeds');
    expect(policy).toContain('CodeQL for that SHA succeeds');
    expect(policy).toContain('no unexpected promotion or rollback mutation is observed');
  });

  it('fails the train closed on bound breach and requires one final reconciliation', () => {
    expect(policy).toContain('MAX_MERGES = 12');
    expect(policy).toContain('MAX_DURATION = 24h');
    expect(policy).toContain('TRAIN_CLOCK_ORIGIN = UTC instant MERGE_1 is recorded');
    expect(policy).toContain('24 hours measured from `TRAIN_CLOCK_ORIGIN`');
    expect(policy).toContain('not the pull-request open time');
    expect(policy).toContain('omits `TRAIN_CLOCK_ORIGIN`');
    expect(policy).toContain('24 hours from `TRAIN_CLOCK_ORIGIN`');
    expect(policy).toContain('TRAIN_CONTINUATION_ALLOWED = NO');
    expect(policy).toContain('12 merges');
    expect(policy).toContain('24 hours');
    expect(policy).toContain('TRAIN_FINAL_RETENTION_COMPLETE = YES');
    expect(policy).toContain('exactly one ordinary full reconciliation');
  });

  it('admits one fail-closed introducing transition and no later bootstrap', () => {
    expect(policy).toContain('FIRST_TRAIN_PR = #963');
    expect(policy).toContain('TRAIN_OWNER = Cursor');
    expect(policy).toContain('TRAIN_START_MAIN = 2ec90a00a7f26895d6badb38bc1885430c0a4d3c');
    expect(policy).toContain('START_BASELINE_RETENTION = TERMINAL');
    expect(policy).toContain('may itself be `TRAIN_MERGE_1`');
    expect(policy).toContain('it becomes `MERGE_1` only when');
    expect(policy).toContain('append #963 to the deferred-retention ledger');
    expect(policy).toContain('without destructive Preview retention');
    expect(policy).toContain('a later pull request cannot label itself the introducing transition');
    expect(policy).toContain('makes that pull request ordinary mode');
    expect(policy).toContain('counts toward `MAX_MERGES`');
    expect(policy).toContain('does not waive the per-merge Production-correctness gates');
    expect(policy).toContain('does not authorize destructive Preview retention');
    expect(policy).toContain('cannot reuse this bootstrap');
    expect(policy).toContain('cannot invoke the introducing transition');
  });

  it('keeps companion docs on the same bounded dependency/toolchain maintenance train', () => {
    for (const relativePath of companionPaths) {
      const source = prose(
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
      );
      expect(source, relativePath).toContain('bounded dependency/toolchain maintenance train');
      expect(source, relativePath).toContain('introducing transition');
      expect(source, relativePath).toContain('cannot reuse that transition');
      expect(source, relativePath).toContain('VERCEL-PREVIEW-RETENTION-POLICY.md');
      expect(source, relativePath).toContain('release-batched Preview retention');
      expect(source, relativePath).toContain('Codex CLI');
      expect(source, relativePath).toContain('Cursor Cloud does not delete Vercel deployments');
      expect(source, relativePath).toContain('cannot reuse that transition');
    }
  });
});

describe('release-batched Preview retention', () => {
  it('defers only destructive preview housekeeping until the release pass', () => {
    expect(policy).toContain('RETENTION_MODE = release-batched preview retention');
    expect(policy).toContain('DESTRUCTIVE_WRITER = Codex CLI, local VS Code / Ubuntu');
    expect(policy).toContain('CURSOR_CLOUD_DESTRUCTIVE_ACCESS = NO');
    expect(policy).toContain(
      'RETENTION_DEFERRED_UNTIL = the next sanctioned v* release reconciliation',
    );
    expect(policy).toContain('BASELINE_MAIN = 8424a7c640074dedac8de24a98fd6932c80c8230');
    expect(policy).toContain('BASELINE_RETENTION = TERMINAL');
    expect(policy).toContain('GATE_7 = maintainer only');
    expect(policy).toContain('PRODUCTION_AUTHORITY_SWITCH = forbidden');
    expect(policy).toContain(
      'TAG_AND_PUBLISH = Codex CLI local only, after GH #911 and this reconciliation',
    );
    expect(policy).toContain('does not authorize a deletion');
    expect(policy).toContain('does not authorize Gate 7 or the production');
    expect(policy).toContain('A later pull request cannot reuse this bootstrap');
    expect(policy).toContain('Cursor Cloud must not delete a deployment or alias');
  });
});
