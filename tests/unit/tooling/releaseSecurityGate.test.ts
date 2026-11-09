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
const tagPushCondition =
  "github.event_name == 'push' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')";
const protectedDockerTagPushCondition = `${tagPushCondition} && github.ref_protected == true`;
const dockerTagPushCondition = `${protectedDockerTagPushCondition} && needs.verify-release-tag.result == 'success' && needs.verify-release-tag.outputs.verified-tag-sha == github.sha && ${gateCondition}`;
// QNBS-v3: GHCR and Tauri publish behind the identical trusted-verifier conjunction.
const tauriReleaseCondition = dockerTagPushCondition;
const proofTagSimulationCondition = `github.event_name == 'workflow_dispatch' && inputs.simulated_event == 'push' && inputs.simulated_ref_type == 'tag' && startsWith(inputs.simulated_ref, 'refs/tags/v') && inputs.simulated_tag_signature == 'verified' && ${gateCondition}`;
const trustedVerifierSha = '147470682b62d5bfe196bba803353d9f25cab8a7';

function mutate(text: string, from: string, to: string): string {
  expect(text, `fixture anchor not found: ${from}`).toContain(from);
  return text.replace(from, to);
}

function addVerifierStepSetting(text: string, setting: string): string {
  const verifierStep = /^([ \t]*)- name: Verify GitHub signatures for the release tag$/m;
  expect(text).toMatch(verifierStep);
  return text.replace(
    verifierStep,
    (_match, indent: string) =>
      `${indent}- name: Verify GitHub signatures for the release tag\n${indent}  ${setting}`,
  );
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

  it('Tauri and GHCR publish only from exact gated v* tag pushes', () => {
    expect(source(TAURI)).toContain(expr(tauriReleaseCondition));
    expect(source(TAURI)).toContain('needs: [bundle, security-audit, verify-release-tag]');
    expect(source(DOCKER)).toContain(expr(dockerTagPushCondition));
    expect(source(DOCKER)).toContain('needs: [security-audit, verify-release-tag]');
  });

  it.each([DOCKER, TAURI])(
    '%s runs the read-only signature verifier from an immutable trusted checkout',
    (name) => {
      const verifier = source(name).slice(source(name).indexOf('  verify-release-tag:\n'));
      expect(verifier).toContain(expr(protectedDockerTagPushCondition));
      expect(verifier).toContain('permissions:\n      contents: read');
      expect(verifier).toContain(`ref: ${trustedVerifierSha}`);
      expect(verifier).toContain('path: trusted-verifier');
      expect(verifier).toContain('fetch-depth: 1');
      expect(verifier).toContain('persist-credentials: false');
      expect(verifier).toContain('node scripts/signing/verify-github-signatures.mjs');
      expect(verifier).toContain(
        `verified-tag-sha: ${expr('steps.verify.outputs.verified-tag-sha')}`,
      );
      expect(verifier).toContain('echo "verified-tag-sha=$GITHUB_SHA" >> "$GITHUB_OUTPUT"');
      expect(verifier).toContain(`GITHUB_REF_TYPE: ${expr('github.ref_type')}`);
      expect(verifier).toContain(`GITHUB_SHA: ${expr('github.sha')}`);
      expect(verifier).toContain(`GITHUB_TOKEN: ${expr('github.token')}`);
      expect(verifier).toContain('env -i PATH="$PATH"');
    },
  );

  it('rejects a Docker publish job that could run from workflow_dispatch', () => {
    const dispatchCanPublish = mutate(
      source(DOCKER),
      expr(dockerTagPushCondition),
      expr(dockerTagPushCondition.replace(`${tagPushCondition} && `, '')),
    );
    expect(messages(DOCKER, dispatchCanPublish)).toMatch(
      /job "build-push" if: must require github\.event_name == 'push'/,
    );
  });

  it('rejects an unprotected release tag even if it is a signed v* push', () => {
    const unprotectedVerifier = mutate(
      source(DOCKER),
      expr(protectedDockerTagPushCondition),
      expr(tagPushCondition),
    );
    expect(messages(DOCKER, unprotectedVerifier)).toMatch(
      /must require github\.ref_protected == true/,
    );
  });

  it('rejects a workflow_dispatch even when its ref happens to be a v* tag', () => {
    const dispatchOnTag = mutate(
      source(DOCKER),
      expr(dockerTagPushCondition),
      expr(
        dockerTagPushCondition.replace(
          "github.event_name == 'push'",
          "github.event_name == 'workflow_dispatch'",
        ),
      ),
    );
    expect(messages(DOCKER, dispatchOnTag)).toMatch(
      /job "build-push" if: must require github\.event_name == 'push'/,
    );
  });

  it('rejects a permissive OR branch even when the required tag and audit predicates remain', () => {
    const permissiveOr = mutate(
      source(DOCKER),
      expr(dockerTagPushCondition),
      expr(`${dockerTagPushCondition} || true`),
    );
    expect(messages(DOCKER, permissiveOr)).toMatch(/must not contain a permissive OR branch/);
  });

  it('rejects a workflow_dispatch OR branch as an alternate publish path', () => {
    const alternateDispatch = mutate(
      source(DOCKER),
      expr(dockerTagPushCondition),
      expr(`${dockerTagPushCondition} || github.event_name == 'workflow_dispatch'`),
    );
    expect(messages(DOCKER, alternateDispatch)).toMatch(/must not contain a permissive OR branch/);
  });

  it('requires the signature-verification result as well as the verifier job dependency', () => {
    const noVerifierDependency = mutate(
      source(DOCKER),
      'needs: [security-audit, verify-release-tag]',
      'needs: [security-audit]',
    );
    expect(messages(DOCKER, noVerifierDependency)).toMatch(/must need "verify-release-tag"/);

    const noVerifierResult = mutate(
      source(DOCKER),
      "needs.verify-release-tag.result == 'success' && ",
      '',
    );
    expect(messages(DOCKER, noVerifierResult)).toMatch(
      /must require needs\.verify-release-tag\.result == 'success'/,
    );

    const noVerifiedTargetEquality = mutate(
      source(DOCKER),
      'needs.verify-release-tag.outputs.verified-tag-sha == github.sha && ',
      '',
    );
    expect(messages(DOCKER, noVerifiedTargetEquality)).toMatch(
      /must require needs\.verify-release-tag\.outputs\.verified-tag-sha == github\.sha/,
    );

    const missingVerifierOutput = mutate(
      source(DOCKER),
      `verified-tag-sha: ${expr('steps.verify.outputs.verified-tag-sha')}`,
      `verified-tag-sha: ${expr('github.sha')}`,
    );
    expect(messages(DOCKER, missingVerifierOutput)).toMatch(
      /must expose only the verified tag target SHA/,
    );
  });

  it('rejects a Docker verifier that does not run the real GitHub signature check', () => {
    const noSignatureCheck = mutate(
      source(DOCKER),
      'node scripts/signing/verify-github-signatures.mjs',
      'node -e "process.exit(0)"',
    );
    expect(messages(DOCKER, noSignatureCheck)).toMatch(
      /must invoke node scripts\/signing\/verify-github-signatures\.mjs from the trusted checkout/,
    );
  });

  it('rejects a verifier checkout that follows the mutable tag or branch', () => {
    const tagSuppliedVerifier = mutate(
      source(DOCKER),
      `ref: ${trustedVerifierSha}`,
      `ref: ${expr('github.ref_name')}`,
    );
    expect(messages(DOCKER, tagSuppliedVerifier)).toMatch(/immutable trusted verifier/);
  });

  it('rejects verifier command wrappers that can alter execution before signature checking', () => {
    const preloadedVerifier = mutate(
      source(DOCKER),
      'node scripts/signing/verify-github-signatures.mjs',
      'node --require=./preload.mjs scripts/signing/verify-github-signatures.mjs',
    );
    expect(messages(DOCKER, preloadedVerifier)).toMatch(
      /must run the pinned verifier from its trusted checkout with a clean environment/,
    );
  });

  it('rejects NODE_OPTIONS or any extra variable in the verifier environment', () => {
    const injectedStepEnv = mutate(
      source(DOCKER),
      `GITHUB_SHA: ${expr('github.sha')}`,
      `GITHUB_SHA: ${expr('github.sha')}\n          NODE_OPTIONS: --require=./preload.mjs`,
    );
    expect(messages(DOCKER, injectedStepEnv)).toMatch(
      /only the allowlisted real tag-push environment/,
    );
  });

  it('rejects inherited workflow or job environment injection', () => {
    const injectedWorkflowEnv = mutate(
      source(DOCKER),
      'jobs:\n',
      'env:\n  NODE_OPTIONS: --require=./preload.mjs\njobs:\n',
    );
    expect(messages(DOCKER, injectedWorkflowEnv)).toMatch(/must not define inherited environment/);

    const injectedJobEnv = mutate(
      source(DOCKER),
      '    steps:\n      - name: Check out the pinned trusted verifier',
      '    env:\n      NODE_OPTIONS: --require=./preload.mjs\n    steps:\n      - name: Check out the pinned trusted verifier',
    );
    expect(messages(DOCKER, injectedJobEnv)).toMatch(/must not inherit environment/);
  });

  it('rejects a manually dispatched tag as input to the real signature-verification job', () => {
    const dispatchVerifier = mutate(
      source(DOCKER),
      expr(protectedDockerTagPushCondition),
      expr(
        "github.event_name == 'workflow_dispatch' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')",
      ),
    );
    expect(messages(DOCKER, dispatchVerifier)).toMatch(
      /job "verify-release-tag" if: must require github\.event_name == 'push'/,
    );
  });

  it.each([
    ['a verifier step that can be skipped', 'if: false', /must not have an if:/],
    [
      'a verifier step whose failure is ignored',
      'continue-on-error: true',
      /must not set continue-on-error/,
    ],
  ])('%s', (_label, unsafeSetting, expectedFailure) => {
    const insecureVerifier = addVerifierStepSetting(source(DOCKER), unsafeSetting);
    expect(messages(DOCKER, insecureVerifier)).toMatch(expectedFailure);
  });

  it('binds signature verification to the actual GitHub push context', () => {
    const wrongContext = mutate(
      source(DOCKER),
      `GITHUB_REF_TYPE: ${expr('github.ref_type')}`,
      `GITHUB_REF_TYPE: ${expr('inputs.simulated_ref_type')}`,
    );
    expect(messages(DOCKER, wrongContext)).toMatch(
      /must pass only the allowlisted real tag-push environment to the signature verifier/,
    );
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

describe('#1206 Tauri release trusts only the pinned-verifier proof', () => {
  const releaseWith = (condition: string) =>
    mutate(source(TAURI), expr(tauriReleaseCondition), expr(condition));
  const withoutPart = (part: string) => releaseWith(tauriReleaseCondition.replace(part, ''));
  const releaseCheckout = (ref: string) =>
    `- name: Check out the exact audited commit\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${expr(ref)}`;

  it('builds with the signing secrets only for the verified tag target and the exact commit', () => {
    expect(source(TAURI)).toMatch(
      /needs\.verify-release-tag\.result == 'success' &&\s+needs\.verify-release-tag\.outputs\.verified-tag-sha == github\.sha\s+\)/,
    );
    expect(source(TAURI)).toContain(
      `ref: ${expr('github.sha')}\n          persist-credentials: false\n      # QNBS-v3: composite action`,
    );
  });

  it.each<[string, () => string, RegExp]>([
    [
      'a release that could run from workflow_dispatch',
      () => withoutPart(`${tagPushCondition} && `),
      /job "release" if: must require github\.event_name == 'push'/,
    ],
    [
      'a release for an unprotected tag',
      () => withoutPart(' && github.ref_protected == true'),
      /job "release" if: must require github\.ref_protected == true/,
    ],
    [
      'a release that ignores the verifier result',
      () => withoutPart(" && needs.verify-release-tag.result == 'success'"),
      /job "release" if: must require needs\.verify-release-tag\.result == 'success'/,
    ],
    [
      'a release that ignores the verified tag target',
      () => withoutPart(' && needs.verify-release-tag.outputs.verified-tag-sha == github.sha'),
      /job "release" if: must require needs\.verify-release-tag\.outputs\.verified-tag-sha == github\.sha/,
    ],
    [
      'a release with a permissive OR branch',
      () => releaseWith(`${tauriReleaseCondition} || true`),
      /job "release" if: must not contain a permissive OR branch/,
    ],
    [
      'a release behind a status function',
      () => releaseWith(`always() && ${tauriReleaseCondition}`),
      /job "release" if: must not use a status function/,
    ],
    [
      'a release without the verifier job dependency',
      () =>
        mutate(
          source(TAURI),
          'needs: [bundle, security-audit, verify-release-tag]',
          'needs: [bundle, security-audit]',
        ),
      /job "release" must need "verify-release-tag"/,
    ],
    [
      'a release that checks out the mutable tag ref',
      () => mutate(source(TAURI), releaseCheckout('github.sha'), releaseCheckout('github.ref')),
      /job "release" must check out ref/,
    ],
    [
      'a verifier that is not pinned to trusted code',
      () => mutate(source(TAURI), `ref: ${trustedVerifierSha}`, `ref: ${expr('github.ref_name')}`),
      /immutable trusted verifier/,
    ],
    [
      'a verifier job for an unprotected tag',
      () => mutate(source(TAURI), expr(protectedDockerTagPushCondition), expr(tagPushCondition)),
      /job "verify-release-tag" if: must require github\.ref_protected == true/,
    ],
    [
      'a verifier job that a manual dispatch can start',
      () =>
        mutate(
          source(TAURI),
          expr(protectedDockerTagPushCondition),
          expr(
            "github.event_name == 'workflow_dispatch' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')",
          ),
        ),
      /job "verify-release-tag" if: must require github\.event_name == 'push'/,
    ],
    [
      'a verifier that does not run the real signature check',
      () =>
        mutate(
          source(TAURI),
          'node scripts/signing/verify-github-signatures.mjs',
          'node -e "process.exit(0)"',
        ),
      /must invoke node scripts\/signing\/verify-github-signatures\.mjs from the trusted checkout/,
    ],
    [
      'a verifier wrapped in a preload',
      () =>
        mutate(
          source(TAURI),
          'node scripts/signing/verify-github-signatures.mjs',
          'node --require=./preload.mjs scripts/signing/verify-github-signatures.mjs',
        ),
      /must run the pinned verifier from its trusted checkout with a clean environment/,
    ],
    [
      'a verifier environment with NODE_OPTIONS',
      () =>
        mutate(
          source(TAURI),
          `GITHUB_SHA: ${expr('github.sha')}`,
          `GITHUB_SHA: ${expr('github.sha')}\n          NODE_OPTIONS: --require=./preload.mjs`,
        ),
      /only the allowlisted real tag-push environment/,
    ],
    [
      'a verifier output that is not the verified tag target',
      () =>
        mutate(
          source(TAURI),
          `verified-tag-sha: ${expr('steps.verify.outputs.verified-tag-sha')}`,
          `verified-tag-sha: ${expr('github.sha')}`,
        ),
      /must expose only the verified tag target SHA/,
    ],
    [
      'a verifier step that can be skipped',
      () => addVerifierStepSetting(source(TAURI), 'if: false'),
      /must not have an if:/,
    ],
    [
      'a verifier step whose failure is ignored',
      () => addVerifierStepSetting(source(TAURI), 'continue-on-error: true'),
      /must not set continue-on-error/,
    ],
    [
      'an inherited workflow environment',
      () =>
        mutate(source(TAURI), 'jobs:\n', 'env:\n  NODE_OPTIONS: --require=./preload.mjs\njobs:\n'),
      /must not define inherited environment/,
    ],
  ])('rejects %s', (_label, build, expected) => {
    expect(messages(TAURI, build())).toMatch(expected);
  });
});

describe('#911 release security gate: weakening it fails', () => {
  it.each(
    (
      [
        [
          'Tauri release without the audit need',
          TAURI,
          'needs: [bundle, security-audit, verify-release-tag]',
          'needs: [bundle, verify-release-tag]',
          /must need "security-audit"/,
        ],
        [
          'GHCR build-push without the audit need',
          DOCKER,
          'needs: [security-audit, verify-release-tag]',
          'needs: [verify-release-tag]',
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
          expr(dockerTagPushCondition),
          expr(
            `github.event_name == 'push' && github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v') && !cancelled() && ${gateCondition}`,
          ),
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

  it('its stand-in simulates only a v* tag push and audits the dispatch input', () => {
    expect(source(PROOF)).toContain(expr(proofTagSimulationCondition));
    expect(source(PROOF)).toContain(`EXPECTED_SHA: ${expr('inputs.expected-sha')}`);
    expect(source(PROOF)).toContain('simulated_tag_signature');
    expect(messages(PROOF, source(PROOF))).toEqual('');
  });

  it('rejects a proof stand-in that treats a simulated manual dispatch as a publish', () => {
    const dispatchAsPublish = mutate(
      source(PROOF),
      "inputs.simulated_event == 'push'",
      "inputs.simulated_event == 'workflow_dispatch'",
    );
    expect(messages(PROOF, dispatchAsPublish)).toMatch(
      /must require inputs\.simulated_event == 'push'/,
    );
  });

  it('rejects the proof when simulated tag signature verification is not successful', () => {
    const unverifiedTag = mutate(
      source(PROOF),
      "inputs.simulated_tag_signature == 'verified'",
      "inputs.simulated_tag_signature == 'rejected'",
    );
    expect(messages(PROOF, unverifiedTag)).toMatch(
      /must require inputs\.simulated_tag_signature == 'verified'/,
    );
  });
});
