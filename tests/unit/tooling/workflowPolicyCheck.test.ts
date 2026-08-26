import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  checkActionFile,
  checkActionPins,
  checkAggregatorNeeds,
  checkAllWorkflows,
  checkJobWriteScopeAllowlist,
  checkNeedsGraph,
  checkPublishingBoundary,
  checkTopLevelPermissions,
  checkWorkflowFile,
  getTriggers,
  listActionFiles,
} from '../../../scripts/workflow-policy-check.mjs';
import type { WorkflowPolicyFailure } from '../../../scripts/workflow-policy-check.d.mts';

const doc = (yaml: string) => parseDocument(yaml, { uniqueKeys: true });
// QNBS-v3: stays string concat — a template literal here is `${{ ${expr} }}`, a JS SyntaxError, not just a style nit.
const githubExpression = (expression: string) => '$' + '{{ ' + expression + ' }}';

// QNBS-v3: contents:read is the only safe top-level default — every other form is a policy gap.
describe('checkTopLevelPermissions', () => {
  it('passes for the canonical {contents: read} form', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkTopLevelPermissions('x.yml', doc('permissions:\n  contents: read\njobs: {}\n'), failures);
    expect(failures).toEqual([]);
  });

  it('passes for the scalar "read-all" form (OSSF Scorecard convention)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkTopLevelPermissions('x.yml', doc('permissions: read-all\njobs: {}\n'), failures);
    expect(failures).toEqual([]);
  });

  it('fails when a top-level write permission is declared', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkTopLevelPermissions(
      'x.yml',
      doc('permissions:\n  contents: write\njobs: {}\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/contents: read/);
  });

  it('fails when the permissions block is missing entirely', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkTopLevelPermissions('x.yml', doc('jobs: {}\n'), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/missing/);
  });
});

// QNBS-v3: job-level scalar write-all must be caught here too, not only rejected at top level.
describe('checkJobWriteScopeAllowlist', () => {
  it('allows an allowlisted job/permission pair', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkJobWriteScopeAllowlist(
      'ci.yml',
      doc('jobs:\n  build:\n    permissions:\n      attestations: write\n'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('fails for a write permission not on the allowlist for that job', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkJobWriteScopeAllowlist(
      'ci.yml',
      doc('jobs:\n  quality:\n    permissions:\n      contents: write\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/unallowlisted write permission "contents"/);
  });

  it('fails for a write permission on an allowlisted job but not in its allowed set', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkJobWriteScopeAllowlist(
      'ci.yml',
      doc('jobs:\n  build:\n    permissions:\n      contents: write\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
  });

  it('passes for the job-level scalar "read-all"', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkJobWriteScopeAllowlist('ci.yml', doc('jobs:\n  build:\n    permissions: read-all\n'), failures);
    expect(failures).toEqual([]);
  });

  it('fails for the job-level scalar "write-all" (grants every scope, never allowlisted)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkJobWriteScopeAllowlist(
      'ci.yml',
      doc('jobs:\n  build:\n    permissions: write-all\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/scalar permissions "write-all"/);
  });

  // QNBS-v3: a per-key alias (contents: *grant) must resolve to "write", not the literal "*grant".
  it('resolves a per-key alias inside a job permissions map', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = ['x: &grant write', 'jobs:', '  build:', '    permissions:', '      contents: *grant', ''].join(
      '\n',
    );
    checkJobWriteScopeAllowlist('ci.yml', doc(content), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/contents/);
  });

  // QNBS-v3: an aliased whole job (ci-success: *base) is an Alias node, not a map, until resolved.
  it('resolves an aliased whole-job node before checking its permissions', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = [
      'jobs:',
      '  base: &base',
      '    permissions:',
      '      contents: write',
      '  copy: *base',
      '',
    ].join('\n');
    checkJobWriteScopeAllowlist('ci.yml', doc(content), failures);
    expect(failures.some((f) => f.message.includes('"copy"'))).toBe(true);
  });
});

// QNBS-v3: needs-graph resolution/cycle-detection protects the aggregator sync check downstream.
describe('checkNeedsGraph', () => {
  it('passes when every needs reference resolves to a real job', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkNeedsGraph('x.yml', doc('jobs:\n  a: {}\n  b:\n    needs: [a]\n'), failures);
    expect(failures).toEqual([]);
  });

  it('fails for an orphaned needs reference', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkNeedsGraph('x.yml', doc('jobs:\n  a:\n    needs: [ghost]\n'), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/unknown job "ghost"/);
  });

  it('detects a two-job needs cycle', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkNeedsGraph(
      'x.yml',
      doc('jobs:\n  a:\n    needs: [b]\n  b:\n    needs: [a]\n'),
      failures,
    );
    expect(failures.some((f) => f.message.includes('cycle detected'))).toBe(true);
  });

  // QNBS-v3: an aliased needs: list (c.needs: *deps) is an Alias node until resolved.
  it('resolves an aliased needs: list shared between two jobs', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkNeedsGraph(
      'x.yml',
      doc('jobs:\n  a: {}\n  b:\n    needs: &deps [a]\n  c:\n    needs: *deps\n'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('fails for an orphaned reference inside an aliased needs: list', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkNeedsGraph(
      'x.yml',
      doc('jobs:\n  a: {}\n  b:\n    needs: &deps [ghost]\n  c:\n    needs: *deps\n'),
      failures,
    );
    expect(failures.filter((f) => f.message.includes('unknown job "ghost"'))).toHaveLength(2);
  });
});

// QNBS-v3: walks the parsed step tree so block AND flow-mapping uses: forms both get pin-checked.
describe('checkActionPins', () => {
  const wrap = (usesLine: string) => `jobs:\n  a:\n    steps:\n      - ${usesLine}\n`;
  const runsWrap = (usesLine: string) => `runs:\n  using: composite\n  steps:\n    - ${usesLine}\n`;

  it('passes a 40-hex SHA pin with a trailing comment', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc(wrap('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1')),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('passes a non-SemVer trailing comment (e.g. a channel name)', () => {
    // QNBS-v3: dtolnay/rust-toolchain pins "# stable", not vX.Y.Z — must not be a false positive.
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc(wrap('uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable')),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('skips a local composite action reference under the governed directory', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap('uses: ./.github/actions/setup')), failures);
    expect(failures).toEqual([]);
  });

  // QNBS-v3: only .github/actions/** is scanned by listActionFiles — anywhere else is unchecked.
  it('fails for a local action reference outside .github/actions/', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap('uses: ./ci/setup')), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/outside the governed \.github\/actions\//);
  });

  it('fails for a floating tag instead of a SHA', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap('uses: actions/checkout@v4 # v4')), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('fails for a SHA pin missing its trailing comment', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc(wrap('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/missing a trailing # comment/);
  });

  it('fails for an unpinned action reference written as a flow-mapping step', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap('{ uses: actions/checkout@v4 }')), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('passes a SHA-pinned flow-mapping step whose comment trails the flow map', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc(wrap('{ uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 } # v7.0.1')),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('checks a composite action\'s runs.steps when fileKind is "action"', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('action.yml', doc(runsWrap('uses: actions/checkout@v4 # v4')), failures, {
      fileKind: 'action',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('ignores jobs.*.steps when fileKind is "action" (composite actions have no jobs)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('action.yml', doc(wrap('uses: actions/checkout@v4 # v4')), failures, {
      fileKind: 'action',
    });
    expect(failures).toEqual([]);
  });

  // QNBS-v3: a Docker action has no steps: at all — its own runs.image needs the same pin check.
  it('fails for a mutable docker image on a Docker action (runs.using: docker)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('action.yml', doc('runs:\n  using: docker\n  image: docker://alpine:latest\n'), failures, {
      fileKind: 'action',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/@sha256/);
  });

  it('passes a Docker action image pinned to an immutable @sha256 digest', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'action.yml',
      doc(`runs:\n  using: docker\n  image: docker://alpine@sha256:${'a'.repeat(64)}\n`),
      failures,
      { fileKind: 'action' },
    );
    expect(failures).toEqual([]);
  });

  it('passes a Docker action built from a local Dockerfile (no registry pin concept)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('action.yml', doc('runs:\n  using: docker\n  image: Dockerfile\n'), failures, {
      fileKind: 'action',
    });
    expect(failures).toEqual([]);
  });

  // QNBS-v3: a job calling a reusable workflow carries the same mutable-ref risk as a step's uses:.
  it('fails for an unpinned job-level reusable-workflow reference', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc('jobs:\n  call:\n    uses: owner/repo/.github/workflows/file.yml@main\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('passes a SHA-pinned job-level reusable-workflow reference', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      doc(
        'jobs:\n  call:\n    uses: owner/repo/.github/workflows/file.yml@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n',
      ),
      failures,
    );
    expect(failures).toEqual([]);
  });

  // QNBS-v3: a mutable docker tag is as unpinned as a floating action tag — must require a digest.
  it('fails for a mutable docker:// tag reference', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap('uses: docker://alpine:latest')), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/@sha256/);
  });

  it('passes a docker:// reference pinned to an immutable @sha256 digest', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', doc(wrap(`uses: docker://alpine@sha256:${'a'.repeat(64)}`)), failures);
    expect(failures).toEqual([]);
  });

  // QNBS-v3: GitHub resolves *action_ref before running the step — the checker must do the same.
  it('fails for an unpinned action reference hidden behind an alias', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = ['x: &action_ref actions/checkout@v4', 'jobs:', '  a:', '    steps:', '      - uses: *action_ref', ''].join(
      '\n',
    );
    checkActionPins('x.yml', doc(content), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('passes a SHA-pinned action reference behind an alias, comment at the anchor definition', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = [
      'x: &action_ref actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: *action_ref',
      '',
    ].join('\n');
    checkActionPins('x.yml', doc(content), failures);
    expect(failures).toEqual([]);
  });

  // QNBS-v3: an aliased whole steps: list (steps: *shared) is an Alias node, not a sequence, until resolved.
  it('checks an aliased steps: list, not just an aliased individual step', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = [
      'x: &shared_steps',
      '  - uses: actions/checkout@v4',
      'jobs:',
      '  a:',
      '    steps: *shared_steps',
      '',
    ].join('\n');
    checkActionPins('x.yml', doc(content), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });
});

// QNBS-v3: needs: quality (bare string) must resolve as one dependency, not per-character Set entries.
describe('checkAggregatorNeeds', () => {
  it('no-ops when the workflow has no ci-success aggregator', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds('x.yml', doc('jobs:\n  a: {}\n'), failures);
    expect(failures).toEqual([]);
  });

  it('passes when needs exactly matches the gating job set', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc(
        'jobs:\n  a: {}\n  b:\n    continue-on-error: true\n  deploy:\n    needs: [ci-success]\n  ci-success:\n    needs: [a]\n',
      ),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('fails when a gating job is missing from needs', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds('ci.yml', doc('jobs:\n  a: {}\n  ci-success:\n    needs: []\n'), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/missing gating job "a"/);
  });

  it('fails when needs lists an advisory (continue-on-error) job', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc(
        'jobs:\n  a: {}\n  storybook:\n    continue-on-error: true\n  ci-success:\n    needs: [a, storybook]\n',
      ),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/not a gating job/);
  });

  it('treats a bare-string ci-success.needs as a single one-item dependency, not characters', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc('jobs:\n  quality: {}\n  ci-success:\n    needs: quality\n'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('fails when if: always() is set but the run script never checks a gating job\'s result', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc(
        'jobs:\n  a: {}\n  ci-success:\n    if: always()\n    needs: [a]\n    steps:\n      - run: echo ok\n',
      ),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/never check needs\.a\.result/);
  });

  it('passes when if: always() is set and the run script checks every gating job\'s result', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const runLine = `[ \\"${githubExpression('needs.a.result')}\\" = success ] || exit 1`;
    checkAggregatorNeeds(
      'ci.yml',
      doc(`jobs:\n  a: {}\n  ci-success:\n    if: always()\n    needs: [a]\n    steps:\n      - run: "${runLine}"\n`),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('does not require a result check when if: always() is absent (default GH gating applies)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc('jobs:\n  a: {}\n  ci-success:\n    needs: [a]\n    steps:\n      - run: echo ok\n'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('finds a result check split across multiple run steps', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const stepA = `- run: "[ \\"${githubExpression('needs.a.result')}\\" = success ] || exit 1"`;
    const stepB = `- run: "[ \\"${githubExpression('needs.b.result')}\\" = success ] || exit 1"`;
    checkAggregatorNeeds(
      'ci.yml',
      doc(
        `jobs:\n  a: {}\n  b: {}\n  ci-success:\n    if: always()\n    needs: [a, b]\n    steps:\n      ${stepA}\n      ${stepB}\n`,
      ),
      failures,
    );
    expect(failures).toEqual([]);
  });

  // QNBS-v3: a bare reference (e.g. echo) logs the result but can't fail the job — must be rejected.
  it('rejects a result reference that is only logged, never used to control failure', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const stepA = `- run: "echo ${githubExpression('needs.a.result')}"`;
    const stepB = `- run: "echo ${githubExpression('needs.b.result')}"`;
    checkAggregatorNeeds(
      'ci.yml',
      doc(
        `jobs:\n  a: {}\n  b: {}\n  ci-success:\n    if: always()\n    needs: [a, b]\n    steps:\n      ${stepA}\n      ${stepB}\n`,
      ),
      failures,
    );
    expect(failures).toHaveLength(2);
  });

  // QNBS-v3: a commented-out exit can't affect real control flow — must not count as a check.
  it('rejects a result reference whose only exit is inside a shell comment', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const runLine = `echo ${githubExpression('needs.a.result')}\\n# exit 1`;
    checkAggregatorNeeds(
      'ci.yml',
      doc(`jobs:\n  a: {}\n  ci-success:\n    if: always()\n    needs: [a]\n    steps:\n      - run: "${runLine}"\n`),
      failures,
    );
    expect(failures).toHaveLength(1);
  });

  // QNBS-v3: smoke needs deploy needs ci-success — smoke is a transitive, not just direct, descendant.
  it('excludes a transitive descendant of ci-success, not only a direct one', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc('jobs:\n  a: {}\n  ci-success:\n    needs: [a]\n  deploy:\n    needs: [ci-success]\n  smoke:\n    needs: [deploy]\n'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  // QNBS-v3: failure()/cancelled() bypass default gating exactly like always() — must be caught too.
  it('fails when if: failure() is set but the run script never checks a gating job\'s result', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc('jobs:\n  a: {}\n  ci-success:\n    if: failure()\n    needs: [a]\n    steps:\n      - run: echo ok\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
  });

  it('fails when if: !cancelled() is set but the run script never checks a gating job\'s result', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkAggregatorNeeds(
      'ci.yml',
      doc('jobs:\n  a: {}\n  ci-success:\n    if: "!cancelled()"\n    needs: [a]\n    steps:\n      - run: echo ok\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
  });

  // QNBS-v3: an aliased if: condition (if: *cond) is an Alias node until resolved.
  it('fails when an aliased if: condition resolves to always()', () => {
    const failures: WorkflowPolicyFailure[] = [];
    const content = [
      'x: &cond always()',
      'jobs:',
      '  a: {}',
      '  ci-success:',
      '    if: *cond',
      '    needs: [a]',
      '    steps:',
      '      - run: echo ok',
      '',
    ].join('\n');
    checkAggregatorNeeds('ci.yml', doc(content), failures);
    expect(failures).toHaveLength(1);
  });
});

// QNBS-v3: scalar write-all implicitly grants contents:write and must not evade this boundary.
describe('checkPublishingBoundary', () => {
  it('passes for contents:write on an allowlisted, tag-restricted publishing job', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary(
      'tauri-build.yml',
      doc(
        `jobs:\n  release:\n    if: ${githubExpression("github.ref_type == 'tag'")}\n    permissions:\n      contents: write\n`,
      ),
      failures,
    );
    expect(failures).toEqual([]);
  });

  // QNBS-v3: allowlisting by (file, job) name alone survives the gate being loosened/removed.
  it('fails for an allowlisted publishing job whose tag-only if: condition was removed', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary(
      'tauri-build.yml',
      doc('jobs:\n  release:\n    permissions:\n      contents: write\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/no longer restricts it to a tag push/);
  });

  it('fails for contents:write on a job not on the publishing allowlist', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary(
      'ci.yml',
      doc('jobs:\n  build:\n    permissions:\n      contents: write\n'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/not on the publishing allowlist/);
  });

  it('fails for the job-level scalar "write-all" on a job not on the publishing allowlist', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary('ci.yml', doc('jobs:\n  build:\n    permissions: write-all\n'), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/not on the publishing allowlist/);
  });

  it('passes for the job-level scalar "read-all" (no implied contents:write)', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary('ci.yml', doc('jobs:\n  build:\n    permissions: read-all\n'), failures);
    expect(failures).toEqual([]);
  });
});

// QNBS-v3: workflow_dispatch/tag-push recognition feeds the S5 qualification-lane boundary check.
describe('getTriggers', () => {
  it('recognizes workflow_dispatch', () => {
    expect(getTriggers(doc('on:\n  workflow_dispatch: {}\njobs: {}\n')).workflowDispatch).toBe(
      true,
    );
  });

  it('recognizes a tag-push trigger', () => {
    expect(getTriggers(doc('on:\n  push:\n    tags: ["v*"]\njobs: {}\n')).tagPush).toBe(true);
  });

  it('reports both false when neither trigger is present', () => {
    const triggers = getTriggers(doc('on:\n  pull_request: {}\njobs: {}\n'));
    expect(triggers).toEqual({ workflowDispatch: false, tagPush: false });
  });
});

describe('checkWorkflowFile (duplicate keys / YAML-level errors)', () => {
  it('reports a YAML parse error for duplicate top-level keys and skips structural checks', () => {
    const content = 'permissions:\n  contents: read\npermissions:\n  contents: write\njobs: {}\n';
    const failures = checkWorkflowFile('duplicate.yml', {
      readFileSync: () => content,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/YAML parse error/);
  });

  it('resolves an anchor/alias pair and validates the resolved content', () => {
    // QNBS-v3: proves anchors/aliases (core YAML) are resolved before structural checks run.
    const content = [
      'permissions: &perms',
      '  contents: read',
      'jobs:',
      '  a:',
      '    permissions: *perms',
      '',
    ].join('\n');
    const failures = checkWorkflowFile('anchors.yml', { readFileSync: () => content });
    expect(failures).toEqual([]);
  });

  it('extracts the filename via basename(), not a hardcoded "/" split, given a nested path', () => {
    // QNBS-v3: basename() is symmetric with join()'s platform separator; a bare split('/') was not.
    const failures = checkWorkflowFile('/repo/.github/workflows/missing-perms.yml', {
      readFileSync: () => 'jobs: {}\n',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe('missing-perms.yml');
  });
});

// QNBS-v3: composite actions are a distinct file kind — only the pin check applies to them.
describe('checkActionFile', () => {
  it('reports an unpinned action reference in a composite action', () => {
    const content = 'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4\n';
    const failures = checkActionFile('.github/actions/setup/action.yml', {
      readFileSync: () => content,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe('action.yml');
  });

  it('passes a fully SHA-pinned composite action', () => {
    const content =
      'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n';
    const failures = checkActionFile('.github/actions/setup/action.yml', {
      readFileSync: () => content,
    });
    expect(failures).toEqual([]);
  });

  it('reports a YAML parse error for a malformed composite action', () => {
    const content = 'runs: [\n';
    const failures = checkActionFile('.github/actions/broken/action.yml', {
      readFileSync: () => content,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/YAML parse error/);
  });
});

describe('listActionFiles', () => {
  it('discovers the repository\'s real .github/actions/setup/action.yml', () => {
    // QNBS-v3: existsSync isn't DI'd (matches listWorkflowFiles), so this hits the real fs.
    const files = listActionFiles();
    expect(
      files.some((filePath) => filePath.endsWith(join('.github', 'actions', 'setup', 'action.yml'))),
    ).toBe(true);
  });

  // QNBS-v3: existsSync isn't DI'd, so the real dir must exist for this fake readdirSync to fire.
  // QNBS-v3: join(), not a literal "/", so the suffix matches join()'s separator on every platform.
  it('discovers a composite action nested below its group directory (recursive)', () => {
    const readdirSync = (dirPath: string) => {
      if (dirPath.endsWith(join('.github', 'actions'))) {
        return [{ name: 'release', isDirectory: () => true }];
      }
      if (dirPath.endsWith(join('.github', 'actions', 'release'))) {
        return [{ name: 'setup', isDirectory: () => true }];
      }
      if (dirPath.endsWith(join('.github', 'actions', 'release', 'setup'))) {
        return [{ name: 'action.yml', isDirectory: () => false }];
      }
      return [];
    };
    const files = listActionFiles(undefined, { readdirSync });
    expect(
      files.some((f) => f.endsWith(join('.github', 'actions', 'release', 'setup', 'action.yml'))),
    ).toBe(true);
  });

  // QNBS-v3: a symlinked directory could redirect a governed action outside .github/actions unseen.
  it('throws when a symlink is found under .github/actions', () => {
    const readdirSync = (dirPath: string) => {
      if (dirPath.endsWith(join('.github', 'actions'))) {
        return [{ name: 'setup', isDirectory: () => false, isSymbolicLink: () => true }];
      }
      return [];
    };
    expect(() => listActionFiles(undefined, { readdirSync })).toThrow(/symlink/i);
  });
});

describe('checkAllWorkflows', () => {
  it('aggregates failures across multiple injected workflow files', () => {
    const files = new Map<string, string>([
      ['/repo/.github/workflows/a.yml', 'jobs: {}\n'],
      ['/repo/.github/workflows/b.yml', 'permissions:\n  contents: read\njobs: {}\n'],
    ]);
    const failures = checkAllWorkflows('/repo', {
      listWorkflowFiles: () => [...files.keys()],
      listActionFiles: () => [],
      readFileSync: (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`unexpected path: ${filePath}`);
        return content;
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe('a.yml');
  });

  it('also aggregates failures from injected composite action files', () => {
    const files = new Map<string, string>([
      ['/repo/.github/workflows/a.yml', 'permissions:\n  contents: read\njobs: {}\n'],
      [
        '/repo/.github/actions/setup/action.yml',
        'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4\n',
      ],
    ]);
    const failures = checkAllWorkflows('/repo', {
      listWorkflowFiles: () => ['/repo/.github/workflows/a.yml'],
      listActionFiles: () => ['/repo/.github/actions/setup/action.yml'],
      readFileSync: (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`unexpected path: ${filePath}`);
        return content;
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe('action.yml');
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  // QNBS-v3: a thrown symlink rejection must surface as a failure, never crash the whole check.
  it('fail-closes a symlink rejection from listActionFiles into a failure, not a crash', () => {
    const failures = checkAllWorkflows('/repo', {
      listWorkflowFiles: () => [],
      listActionFiles: () => {
        throw new Error('symlink not allowed under .github/actions: /repo/.github/actions/setup');
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/symlink/i);
  });
});
