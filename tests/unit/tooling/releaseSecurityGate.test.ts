import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkReleaseSecurityGates,
  checkReleaseSecurityWorkflow,
} from '../../../scripts/release-security-gate.mjs';
import { checkWorkflowFile } from '../../../scripts/workflow-policy-check.mjs';

const workflows = join(__dirname, '../../../.github/workflows');
const source = (name: string) => readFileSync(join(workflows, name), 'utf8');
const TAURI = 'tauri-build.yml';
const DOCKER = 'docker.yml';
const PROOF = 'release-gate-proof.yml';
// QNBS-v3: `\$` keeps the literal GitHub expression syntax out of JS interpolation (Biome noTemplateCurlyInString).
const expr = (expression: string) => `\${{ ${expression} }}`;

const gateCondition =
  "needs.security-audit.result == 'success' && needs.security-audit.outputs.audited-sha == github.sha";
const tauriReleaseCondition = `github.event_name == 'push' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v') && ${gateCondition}`;

function mutate(text: string, from: string, to: string): string {
  expect(text, `fixture anchor not found: ${from}`).toContain(from);
  return text.replace(from, to);
}

const messages = (name: string, text: string) =>
  checkReleaseSecurityWorkflow(name, text)
    .map((failure) => failure.message)
    .join('\n');

describe('#911 release security gate: shipped workflows', () => {
  it('every publishing job waits on an exact-ref audit', () => {
    expect(checkReleaseSecurityGates()).toEqual([]);
  });

  it.each([TAURI, DOCKER, PROOF])('%s also passes the trusted workflow policy on main', (name) => {
    expect(checkWorkflowFile(join(workflows, name))).toEqual([]);
  });

  it('Tauri release and GHCR build-push use the exact gate conditions', () => {
    expect(source(TAURI)).toContain(expr(tauriReleaseCondition));
    expect(source(TAURI)).toContain('needs: [bundle, security-audit]');
    expect(source(DOCKER)).toContain(expr(gateCondition));
    expect(source(DOCKER)).toContain('needs: [security-audit]');
  });

  it('GHCR builds exactly the audited commit', () => {
    expect(source(DOCKER)).toMatch(/ref: \$\{\{ github\.sha \}\}\n\s+persist-credentials: false/);
  });

  it('the three inlined audit jobs are identical apart from the SHA they audit', () => {
    const auditJob = (name: string) => {
      const text = source(name);
      const start = text.indexOf('\n  security-audit:\n');
      const end = text.indexOf('\n\n  ', text.indexOf('id: result', start));
      return text
        .slice(start, end)
        .replace(/\n {4}needs: \[verify-release-tag\]\n {4}if: >-\n.*\n/, '\n')
        .replaceAll(expr('inputs.expected-sha'), expr('github.sha'));
    };
    expect(auditJob(DOCKER)).toBe(auditJob(TAURI));
    expect(auditJob(PROOF)).toBe(auditJob(TAURI));
  });
});

describe('#911 release security gate: weakening it fails', () => {
  it.each(
    (
      [
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
          '    needs: [security-audit]\n',
          '',
          /must need "security-audit"/,
        ],
        [
          'Tauri release after any audit outcome',
          TAURI,
          expr(tauriReleaseCondition),
          expr(`always() && ${tauriReleaseCondition}`),
          /must not use a status function/,
        ],
        [
          'GHCR build-push when the audit is not cancelled',
          DOCKER,
          expr(gateCondition),
          expr(`!cancelled() && ${gateCondition}`),
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
          'GHCR build-push that skips the result check',
          DOCKER,
          "needs.security-audit.result == 'success' && ",
          '',
          /needs\.security-audit\.result == 'success'/,
        ],
        [
          'an audit of a caller-chosen SHA',
          DOCKER,
          `EXPECTED_SHA: ${expr('github.sha')}`,
          `EXPECTED_SHA: ${expr('github.event.inputs.sha')}`,
          /must audit EXPECTED_SHA/,
        ],
        [
          'a checkout of the default ref',
          TAURI,
          `ref: ${expr('github.sha')}\n          fetch-depth: 1`,
          'ref: main\n          fetch-depth: 1',
          /checkout must use ref/,
        ],
        [
          'one lockfile dropped',
          DOCKER,
          '            --lockfile=crates/Cargo.lock\n',
          '',
          /--lockfile=crates\/Cargo\.lock/,
        ],
        [
          'the scanner config dropped',
          TAURI,
          '            --config=src-tauri/osv-scanner.toml\n',
          '',
          /--config=src-tauri\/osv-scanner\.toml/,
        ],
        [
          'the provenance check removed',
          DOCKER,
          'HEAD_SHA="$(git rev-parse HEAD)"',
          'HEAD_SHA="$EXPECTED_SHA"',
          /verify the checked-out HEAD/,
        ],
        [
          'the SHA format check removed',
          TAURI,
          "grep -Eq '^[0-9a-f]{40}$'",
          'true',
          /not 40 hex characters/,
        ],
        [
          'a write permission on the audit job',
          DOCKER,
          '    permissions:\n      contents: read\n    outputs:',
          '    permissions:\n      contents: read\n      packages: write\n    outputs:',
          /exactly permissions/,
        ],
        [
          'an audit output not taken from the scan result',
          TAURI,
          `audited-sha: ${expr('steps.result.outputs.audited-sha')}`,
          `audited-sha: ${expr('github.sha')}`,
          /must output audited-sha/,
        ],
        [
          'a scanner step that can be skipped',
          DOCKER,
          '      - name: OSV vulnerability scan (all three lockfiles)\n',
          '      - name: OSV vulnerability scan (all three lockfiles)\n        if: false\n',
          /must not have an if:/,
        ],
        [
          'a scanner step whose failure is ignored',
          TAURI,
          '      - name: OSV vulnerability scan (all three lockfiles)\n',
          '      - name: OSV vulnerability scan (all three lockfiles)\n        continue-on-error: true\n',
          /must not set continue-on-error/,
        ],
        [
          'an audit job whose failure is ignored',
          DOCKER,
          '    timeout-minutes: 15\n    permissions:\n      contents: read\n    outputs:',
          '    timeout-minutes: 15\n    continue-on-error: true\n    permissions:\n      contents: read\n    outputs:',
          /job "security-audit" must not set continue-on-error/,
        ],
      ] as const
    ).map(([label, name, from, to, message]) => ({ label, name, from, to, message })),
  )('$label', ({ name, from, to, message }) => {
    expect(messages(name, mutate(source(name), from, to))).toMatch(message);
  });

  it('recording the audited SHA before the scan fails', () => {
    const text = source(DOCKER);
    const record =
      '      - name: Record the audited SHA\n        id: result\n        run: echo "audited-sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"\n';
    const moved = mutate(text, record, '').replace(
      '      - name: Validate the requested commit SHA\n',
      `${record}\n      - name: Validate the requested commit SHA\n`,
    );
    expect(messages(DOCKER, moved)).toMatch(/in that order/);
  });

  it('a new write-privileged job beside the gate fails', () => {
    const extra = `${source(DOCKER)}
  sidecar-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - run: echo push
`;
    expect(messages(DOCKER, extra)).toMatch(/"sidecar-push" holds a write permission/);
  });

  it('a workflow without its audit job fails', () => {
    const text = source(PROOF);
    const start = text.indexOf('  security-audit:\n');
    const end = text.indexOf('  publish-stand-in:\n');
    expect(messages(PROOF, text.slice(0, start) + text.slice(end))).toMatch(
      /missing job "security-audit"/,
    );
  });
});

describe('#911 non-publishing gate proof workflow', () => {
  it('holds no write permission and no publishing action', () => {
    expect(source(PROOF)).not.toMatch(/:\s*write\b/);
    expect(source(PROOF)).not.toMatch(/docker\/login-action|action-gh-release|gh release/);
  });

  it('its stand-in uses the exact GHCR build-push condition and audits the dispatch input', () => {
    expect(source(PROOF)).toContain(expr(gateCondition));
    expect(source(PROOF)).toContain(`EXPECTED_SHA: ${expr('inputs.expected-sha')}`);
  });
});
