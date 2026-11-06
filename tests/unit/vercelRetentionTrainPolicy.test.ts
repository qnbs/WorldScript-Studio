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
      expect(source, relativePath).toContain(
        '14 days or 24 non-protected Preview deployments, or provider resource pressure, requires one exceptional Codex CLI pass',
      );
      expect(source, relativePath).toContain('does not restore per-merge destructive cleanup');
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
    expect(policy).toContain('FIRST_BATCH_PR = #1020');
    expect(policy).toContain('BATCH_CLOCK_ORIGIN = UTC instant FIRST_BATCH_PR merges');
    expect(policy).toContain('MAX_BATCH_AGE = 14d');
    expect(policy).toContain('MAX_STALE_PREVIEWS = 24');
    expect(policy).toContain(
      'EXCEPTIONAL_HANDOFF = one local Codex CLI pass, then this batch continues',
    );
    expect(policy).toContain('BATCH_COMPLETE = recorded only after the sanctioned release pass');
    expect(policy).toContain('GATE_7 = maintainer only');
    expect(policy).toContain('PRODUCTION_AUTHORITY_SWITCH = forbidden');
    expect(policy).toContain(
      'TAG_AND_PUBLISH = Codex CLI local only, after GH #911 and this reconciliation',
    );
    expect(policy).toContain('does not authorize a deletion');
    expect(policy).toContain('does not authorize Gate 7 or the production');
    expect(policy).toContain('A later pull request cannot reuse this bootstrap');
    expect(policy).toContain('Cursor Cloud must not delete a deployment or alias');
    expect(policy).toContain('dependent repository mutation');
    expect(policy).toContain('does not restore per-merge destructive cleanup');
    expect(policy).toContain('BATCH_COMPLETE = YES');
    expect(policy).toContain('A count of 24 or more reaches the cap');
    expect(policy).toContain('read-only count of non-protected Preview deployments');
    expect(policy).toContain('not evidence that the count is zero');
    expect(policy).toContain('do not invent a zero count');
    expect(policy).toContain('Resource pressure uses the exceptional');
  });
});

describe('active ordinary per-merge Preview retention', () => {
  it('preserves the historical writer and defines the current exclusive operator lease', () => {
    expect(policy).toContain('## Active mode from 2026-10-13: ordinary per-merge retention');
    expect(policy).toContain('ACTIVE_MODE = ordinary per-merge preview retention');
    expect(policy).toContain(
      'HISTORICAL_DESTRUCTIVE_WRITER_AT_2026-10-13 = Claude Code CLI, local VS Code / Ubuntu',
    );
    expect(policy).toContain(
      'SUPERSEDES = release-batched preview retention record, FIRST_BATCH_PR #1020',
    );
    expect(policy).toContain(
      'SUPERSESSION_AUTHORITY = maintainer decision, GH #627 comment 6134785538',
    );
    expect(policy).toContain('CURRENT_OPERATOR_POLICY = dated operator-eligibility section below');
    expect(policy).toContain(
      'OPERATOR_ELIGIBILITY = local Claude Code CLI | local Codex CLI | Cursor Cloud after GH #1174 capability admission',
    );
    expect(policy).toContain('OPERATOR_LEASE = exactly one active operator/session at a time');
    expect(policy).toContain('RETENTION_RUNTIME = Node 22.19+ with major 22');
    expect(policy).toContain(
      'CURSOR_CLOUD_DESTRUCTIVE_ACCESS = NOT_ADMITTED until explicit maintainer approval in GH #1174',
    );
    expect(policy).toContain(
      'A Vercel token or a source-writer lease alone never grants deletion authority',
    );
    expect(policy).toContain('TAG_AND_PUBLISH = not granted by this record');
    expect(policy).toContain('a project name is never passed to `vercel remove`');
    expect(policy).toContain('does not reuse the #1020 bootstrap');
  });

  it('states the guarantees the canonical runner implements, not stronger ones', () => {
    expect(policy).toContain('before the first write for each ID, that ID is revalidated');
    expect(policy).toContain(
      'to name a branch that is gone; the alias of a branch that still exists',
    );
    expect(policy).toContain('a read that fails (403, 429, 5xx) is retried once');
    expect(policy).toContain('a write that fails is never retried and stops the run unless');
    expect(policy).toContain('A read may retry once and a second failure stops the wave');
    expect(policy).not.toContain('bounded retry/backoff');
    expect(policy).not.toContain('a branch that is gone or a PR that is closed');
  });

  it('keeps the historical batch record and current operator eligibility synchronized in every companion', () => {
    expect(policy).toContain('DESTRUCTIVE_WRITER = Codex CLI, local VS Code / Ubuntu');
    for (const relativePath of companionPaths) {
      const source = prose(
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
      );
      expect(source, relativePath).toContain('As of 2026-10-13 that release-batched mode is');
      expect(source, relativePath).toContain('As of 2026-11-06');
      expect(source, relativePath).toContain('Claude Code CLI or Codex CLI');
      expect(source, relativePath).toContain('NOT_ADMITTED');
      expect(source, relativePath).toContain('#1174');
      expect(source, relativePath).toContain('Cursor Cloud');
      expect(source, relativePath).toContain('qualified local operator');
    }
  });
});

describe('bounded GitHub Pages incident mode', () => {
  it('binds the exception to the reproduced exact-main incident and the five current bot sources', () => {
    expect(policy).toContain(
      '## Bounded GitHub Pages delivery incident mode — GH #1176 (2026-11-06)',
    );
    expect(policy).toContain('INCIDENT_STARTING_MAIN = db85ce826623165eb5f63ed86abae436917e956c');
    expect(policy).toContain('INCIDENT_PUSH_RUN = 42198434875');
    expect(policy).toContain('INCIDENT_PAGES_JOBS = 127838137432, 127843540538');
    expect(policy).toContain('INCIDENT_ARTIFACT = 13493474778');
    expect(policy).toContain(
      'ALLOWED_SOURCE_SET = #1160, #1169, #1170, #1171, #1172, only bounded safe slices',
    );
    expect(policy).toContain('It is separate from the bounded maintenance train');
    expect(policy).toContain('it cannot reuse or extend either record');
  });

  it('caps the exception by both successor merges and elapsed time', () => {
    expect(policy).toContain(
      'INCIDENT_CLOCK_ORIGIN = UTC merge time of this approved policy PR, recorded in GH #1176',
    );
    expect(policy).toContain('MAX_SUCCESSOR_MERGES = 5');
    expect(policy).toContain('MAX_DURATION = 24h from INCIDENT_CLOCK_ORIGIN');
    expect(policy).toContain('five successor merges, 24 hours from the recorded clock origin');
    expect(policy).toContain('No automatic extension');
    expect(policy).toContain(
      'the incident record, activation time, or sole writer lease is missing',
    );
    expect(policy).toContain('the merge count or 24-hour clock expiring');
    expect(policy).toContain('Another writer being active');
  });

  it('allows only the Pages cancellation and workflow-defined skips while preserving all independent gates', () => {
    expect(policy).toContain('Pages must be the only failed or cancelled job');
    expect(policy).toContain('`🚀 Deploy to GitHub Pages`');
    expect(policy).toContain(
      "workflow's `build` job (`🏗️ Build`) `Upload Pages artifact` step succeeded",
    );
    expect(policy).toContain('push-only skip of `📏 PR Size Governance` is admissible');
    expect(policy).toContain('workflow explicitly defines for that event and changed paths');
    expect(policy).toContain('The overall `CI / CD` result remains truthfully `cancelled`');
    expect(policy).toContain(
      '`✅ CI Success`, Workflow Policy, Security Audit/OSV, Verified Signatures',
    );
    expect(policy).toContain('both Node 22 and Node 24 Quality Gates');
    expect(policy).toContain('Advisory Storybook and Deep E2E jobs must also finish successfully');
    expect(policy).toContain('the exception never changes branch-protection settings');
    expect(policy).toContain('the current main SHA does not match the push and CodeQL evidence');
    expect(policy).toContain('the event is not a protected-main push');
    expect(policy).toContain('any required job is absent, pending, skipped');
    expect(policy).toContain('workflow-defined event- or path-based skip reason');
    expect(policy).toContain('after the successful build-job artifact');
    expect(policy).toContain('did not unambiguously reach `syncing_files`');
    expect(policy).toContain(
      'These current-main admission predicates do not require the successor PR to exist.',
    );
    expect(policy).toContain('CI and independent review are merge-boundary evidence');
    expect(policy).toContain('A `workflow_dispatch` run');
    expect(policy).toContain('or a green PR-head check cannot substitute');
  });

  it('keeps destructive Vercel retention and releases held while Pages is degraded', () => {
    expect(policy).toContain(
      'VERCEL_RETENTION = HOLD until normal full CI / CD and CodeQL succeed on current main',
    );
    expect(policy).toContain(
      'The canonical retention runner and its `CI / CD` success requirement are unchanged',
    );
    expect(policy).toContain('Do not run retention `dry-run` or `reconcile`');
    expect(policy).toContain('delete any deployment or alias');
    expect(policy).toContain('The seven SAFE deletions on `b501fa59` are not reusable evidence');
    expect(policy).toContain('TAG_AND_RELEASE = forbidden');
    expect(policy).toContain(
      'first verify full push `CI / CD` and CodeQL on the current main, then complete',
    );
    expect(policy).toContain('the public HTTP check, or rollback protection does not match');
    expect(policy).toContain('any provider/check result being unknown or contradictory');
    expect(policy).toContain('the source is outside the five listed PRs');
    expect(policy).toContain('the successor is unsigned');
    expect(policy).toContain('lacks its independent reviews');
  });

  it('keeps the repository-wide operator instructions aligned with the incident contract', () => {
    const agents = prose(
      readFileSync(fileURLToPath(new URL('../../AGENTS.md', import.meta.url)), 'utf8'),
    );
    expect(agents).toContain('signed, reviewed GH #1176 incident mode');
    expect(agents).toContain('truthful overall workflow result');
    expect(agents).toContain('it defers all Vercel retention');
    expect(agents).toContain('no Vercel deployment or alias deletion is permitted');
  });
});
