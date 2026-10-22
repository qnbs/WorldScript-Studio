import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import type { WorkflowPolicyFailure } from '../../../scripts/workflow-policy-check.d.mts';
import {
  checkReleaseSecurityGate,
  checkReleaseSecurityWorkflow,
  checkWorkflowFile,
} from '../../../scripts/workflow-policy-check.mjs';

const workflows = join(__dirname, '../../../.github/workflows');
const source = (name: string) => readFileSync(join(workflows, name), 'utf8');
const TAURI = 'tauri-build.yml';
const DOCKER = 'docker.yml';
const AUDIT = 'release-security-audit.yml';
// QNBS-v3: `\$` keeps the literal GitHub expression syntax out of JS interpolation (Biome noTemplateCurlyInString).
const expr = (expression: string) => `\${{ ${expression} }}`;

/** Runs the full per-file policy on a (possibly mutated) workflow source under its real name. */
function check(name: string, content: string): WorkflowPolicyFailure[] {
  return checkWorkflowFile(join(workflows, name), { readFileSync: () => content });
}

function gateFailures(name: string, content: string): WorkflowPolicyFailure[] {
  const failures: WorkflowPolicyFailure[] = [];
  const doc = parseDocument(content, { uniqueKeys: true });
  checkReleaseSecurityGate(name, doc, failures);
  checkReleaseSecurityWorkflow(name, doc, failures);
  return failures;
}

function mutate(text: string, from: string, to: string): string {
  expect(text, `fixture anchor not found: ${from}`).toContain(from);
  return text.replace(from, to);
}

const tauriReleaseCondition =
  "github.event_name == 'push' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v') && needs.security-audit.result == 'success' && needs.security-audit.outputs.audited-sha == github.sha";
const tauriReleaseIf = expr(tauriReleaseCondition);
const dockerCondition =
  "needs.security-audit.result == 'success' && needs.security-audit.outputs.audited-sha == github.sha";
const dockerIf = expr(dockerCondition);

describe('#911 release security gate: shipped workflows', () => {
  it.each([TAURI, DOCKER, AUDIT])('%s passes the full workflow policy', (name) => {
    expect(check(name, source(name))).toEqual([]);
  });

  it('Tauri release and GHCR build-push both wait on an exact-SHA audit of github.sha', () => {
    expect(source(TAURI)).toContain(tauriReleaseIf);
    expect(source(TAURI)).toContain('needs: [bundle, security-audit]');
    expect(source(DOCKER)).toContain(dockerIf);
    expect(source(DOCKER)).toContain('needs: [security-audit]');
    for (const name of [TAURI, DOCKER]) {
      expect(source(name)).toContain('uses: ./.github/workflows/release-security-audit.yml');
      expect(source(name)).toContain(`expected-sha: ${expr('github.sha')}`);
    }
  });

  it('GHCR builds exactly the audited commit', () => {
    expect(source(DOCKER)).toMatch(/ref: \$\{\{ github\.sha \}\}\n\s+persist-credentials: false/);
  });
});

describe('#911 release security gate: publish jobs stay blocked when the gate is weakened', () => {
  it.each([
    [
      'Tauri release without the audit need',
      TAURI,
      'needs: [bundle, security-audit]',
      'needs: [bundle]',
      /must need "security-audit"/,
    ],
    [
      'GHCR build-push without the audit need',
      DOCKER,
      'needs: [security-audit]\n',
      '',
      /must need "security-audit"/,
    ],
    [
      'Tauri release that runs after any audit outcome (always())',
      TAURI,
      tauriReleaseIf,
      expr(`always() && ${tauriReleaseCondition}`),
      /must not use a status function/,
    ],
    [
      'GHCR build-push that runs when the audit is not cancelled',
      DOCKER,
      dockerIf,
      expr(`!cancelled() && ${dockerCondition}`),
      /must not use a status function/,
    ],
    [
      'Tauri release that ignores which SHA was audited',
      TAURI,
      ' && needs.security-audit.outputs.audited-sha == github.sha }}',
      ' }}',
      /audited-sha == github\.sha/,
    ],
    [
      'GHCR build-push that only checks the audited SHA, not the result',
      DOCKER,
      "needs.security-audit.result == 'success' && ",
      '',
      /needs\.security-audit\.result == 'success'/,
    ],
    [
      'an audit of a caller-chosen ref instead of github.sha',
      DOCKER,
      `expected-sha: ${expr('github.sha')}`,
      `expected-sha: ${expr('github.event.inputs.sha')}`,
      /expected-sha: \$\{\{ github\.sha \}\}/,
    ],
    [
      'an audit job that calls a different workflow',
      TAURI,
      'uses: ./.github/workflows/release-security-audit.yml',
      'uses: ./.github/workflows/ci.yml',
      /must call \.\/\.github\/workflows\/release-security-audit\.yml/,
    ],
  ])('%s fails', (_label, name, from, to, message) => {
    const failures = gateFailures(name, mutate(source(name), from, to));
    expect(failures.map((failure) => failure.message).join('\n')).toMatch(message);
  });

  it('a new write-privileged job in a gated workflow must sit behind the gate', () => {
    const extra = `${source(DOCKER)}
  sidecar-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - run: echo push
`;
    expect(gateFailures(DOCKER, extra).map((failure) => failure.message)).toContain(
      'job "sidecar-push" holds a write permission but is not behind the #911 release security gate',
    );
  });

  it('a gated workflow that drops its audit job fails', () => {
    const withoutAudit = source(TAURI).replace(/\n {2}security-audit:\n[\s\S]*?\n\n/, '\n');
    expect(withoutAudit).not.toContain('\n  security-audit:');
    expect(gateFailures(TAURI, withoutAudit).map((failure) => failure.message)).toContain(
      'missing job "security-audit" (#911 release gate)',
    );
  });
});

describe('#911 reusable audit workflow: weakening it fails the policy', () => {
  it.each([
    [
      'one lockfile dropped',
      '            --lockfile=crates/Cargo.lock\n',
      '',
      /--lockfile=crates\/Cargo\.lock/,
    ],
    [
      'the scanner config dropped',
      '            --config=src-tauri/osv-scanner.toml\n',
      '',
      /--config=src-tauri\/osv-scanner\.toml/,
    ],
    [
      'a checkout of the default ref',
      `ref: ${expr('inputs.expected-sha')}`,
      'ref: main',
      /checkout must use ref/,
    ],
    [
      'a push trigger added',
      'on:\n  workflow_call:',
      'on:\n  push:\n  workflow_call:',
      /workflow_call only/,
    ],
    [
      'the provenance check removed',
      'HEAD_SHA="$(git rev-parse HEAD)"',
      'HEAD_SHA="$EXPECTED_SHA"',
      /must verify the checked-out HEAD/,
    ],
  ])('%s fails', (_label, from, to, message) => {
    const failures = gateFailures(AUDIT, mutate(source(AUDIT), from, to));
    expect(failures.map((failure) => failure.message).join('\n')).toMatch(message);
  });

  it('the audited-sha output is recorded only after the scan', () => {
    const text = source(AUDIT);
    const scan = text.indexOf('osv-scanner-action/osv-scanner-action@');
    const result = text.indexOf('id: result');
    expect(scan).toBeGreaterThan(-1);
    expect(result).toBeGreaterThan(scan);
    expect(text).toContain(`value: ${expr('jobs.osv-audit.outputs.audited-sha')}`);
  });
});

describe('#911 non-publishing gate proof workflow', () => {
  const PROOF = 'release-gate-proof.yml';

  it('passes the workflow policy and holds no write permission', () => {
    expect(check(PROOF, source(PROOF))).toEqual([]);
    expect(source(PROOF)).not.toMatch(/:\s*write\b/);
    expect(source(PROOF)).not.toMatch(/docker\/login-action|action-gh-release|gh release/);
  });

  it('its publish stand-in uses the exact GHCR build-push condition', () => {
    expect(source(PROOF)).toContain(dockerIf);
    expect(source(PROOF)).toContain('needs: [security-audit]');
    expect(source(PROOF)).toContain('uses: ./.github/workflows/release-security-audit.yml');
  });
});
