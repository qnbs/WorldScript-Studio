import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  checkActionPins,
  checkAggregatorNeeds,
  checkAllWorkflows,
  checkJobWriteScopeAllowlist,
  checkNeedsGraph,
  checkPublishingBoundary,
  checkTopLevelPermissions,
  checkWorkflowFile,
  getTriggers,
} from '../../../scripts/workflow-policy-check.mjs';
import type { WorkflowPolicyFailure } from '../../../scripts/workflow-policy-check.d.mts';

const doc = (yaml: string) => parseDocument(yaml, { uniqueKeys: true });

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
});

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
});

describe('checkActionPins', () => {
  const wrap = (usesLine: string) => `jobs:\n  a:\n    steps:\n      - ${usesLine}\n`;

  it('passes a 40-hex SHA pin with a trailing comment', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      wrap('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('passes a non-SemVer trailing comment (e.g. a channel name)', () => {
    // QNBS-v3: dtolnay/rust-toolchain pins "# stable", not vX.Y.Z — must not be a false positive.
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      wrap('uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable'),
      failures,
    );
    expect(failures).toEqual([]);
  });

  it('skips a local composite action reference', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', wrap('uses: ./.github/actions/setup'), failures);
    expect(failures).toEqual([]);
  });

  it('fails for a floating tag instead of a SHA', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins('x.yml', wrap('uses: actions/checkout@v4 # v4'), failures);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/40-hex-char SHA/);
  });

  it('fails for a SHA pin missing its trailing comment', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkActionPins(
      'x.yml',
      wrap('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'),
      failures,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/missing a trailing # comment/);
  });
});

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
});

describe('checkPublishingBoundary', () => {
  it('passes for contents:write on an allowlisted publishing job', () => {
    const failures: WorkflowPolicyFailure[] = [];
    checkPublishingBoundary(
      'tauri-build.yml',
      doc('jobs:\n  release:\n    permissions:\n      contents: write\n'),
      failures,
    );
    expect(failures).toEqual([]);
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
});

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
});

describe('checkAllWorkflows', () => {
  it('aggregates failures across multiple injected workflow files', () => {
    const files = new Map<string, string>([
      ['/repo/.github/workflows/a.yml', 'jobs: {}\n'],
      ['/repo/.github/workflows/b.yml', 'permissions:\n  contents: read\njobs: {}\n'],
    ]);
    const failures = checkAllWorkflows('/repo', {
      listWorkflowFiles: () => [...files.keys()],
      readFileSync: (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`unexpected path: ${filePath}`);
        return content;
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe('a.yml');
  });
});
