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
// QNBS-v3 (#1219): both publishers also wait on the exact-commit container precheck, before the audit predicates.
const containerPrecheckCondition =
  "needs.container-precheck.result == 'success' && needs.container-precheck.outputs.prechecked-sha == github.sha";
const dockerTagPushCondition = `${tagPushCondition} && needs.verify-release-tag.result == 'success' && needs.verify-release-tag.outputs.verified-tag-sha == github.sha && ${containerPrecheckCondition} && ${gateCondition}`;
// QNBS-v3: GHCR and Tauri publish behind the identical trusted-verifier conjunction.
const tauriReleaseCondition = dockerTagPushCondition;
const proofTagSimulationCondition = `github.event_name == 'workflow_dispatch' && inputs.simulated_event == 'push' && inputs.simulated_ref_type == 'tag' && startsWith(inputs.simulated_ref, 'refs/tags/v') && inputs.simulated_tag_signature == 'verified' && ${gateCondition}`;
const trustedVerifierSha = 'd46ae7969b6a8034de0c998ac3376e4fb7474f4a';
// QNBS-v3 (#1218): this verifier compared the push event's after with github.sha, which no annotated tag can satisfy, so no workflow may pin it again.
const defectiveVerifierSha = 'd348d863f0cc230e3fad64924eb8c76dab91ad0e';

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
    expect(source(TAURI)).toContain(
      'needs: [bundle, security-audit, verify-release-tag, container-precheck]',
    );
    expect(source(DOCKER)).toContain(expr(dockerTagPushCondition));
    expect(source(DOCKER)).toContain(
      'needs: [security-audit, verify-release-tag, container-precheck]',
    );
  });

  it.each([DOCKER, TAURI, 'tag-verifier-proof.yml'])(
    '%s no longer pins the defective verifier',
    (name) => {
      expect(source(name)).not.toContain(defectiveVerifierSha);
    },
  );

  it.each([DOCKER, TAURI])(
    '%s runs the read-only signature verifier from an immutable trusted checkout',
    (name) => {
      const verifier = source(name).slice(source(name).indexOf('  verify-release-tag:\n'));
      expect(verifier).toContain(expr(tagPushCondition));
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

  // QNBS-v3 (#1206): github.ref_protected is unreliable for tag pushes; tag protection is verified inside the pinned verifier instead.
  it.each([DOCKER, TAURI])('%s does not depend on github.ref_protected', (name) => {
    expect(source(name)).not.toContain('ref_protected');
  });

  // QNBS-v3 (#1206): the proof must run the same pinned verifier as production, with no way to write anything.
  it('the tag verifier proof is dispatch-only, read-only and pinned like the release verifiers', () => {
    const proof = source('tag-verifier-proof.yml');
    expect(proof).toContain(`ref: ${trustedVerifierSha}`);
    expect(proof).toContain('eventAfter: ref.object.sha');
    expect(proof).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(proof).not.toMatch(/^ {2}(?:push|pull_request|schedule|release):/m);
    expect(proof).not.toMatch(/: write\b|id-token|secrets\./);
    expect(checkWorkflowFile(join(workflows, 'tag-verifier-proof.yml'))).toEqual([]);
  });

  it.each([DOCKER, TAURI])(
    '%s rejects a verifier condition that is looser or stricter than the exact one',
    (name) => {
      const looser = mutate(
        source(name),
        expr(tagPushCondition),
        expr(`${tagPushCondition} || true`),
      );
      expect(messages(name, looser)).toMatch(
        /job "verify-release-tag" if: must not contain a permissive OR branch/,
      );
      const stricter = mutate(
        source(name),
        expr(tagPushCondition),
        expr(`${tagPushCondition} && github.ref_protected == true`),
      );
      expect(messages(name, stricter)).toMatch(
        /job "verify-release-tag" if: must equal the exact fail-closed condition/,
      );
    },
  );

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
      'needs: [security-audit, verify-release-tag, container-precheck]',
      'needs: [security-audit, container-precheck]',
    );
    expect(messages(DOCKER, noVerifierDependency)).toMatch(/must need "verify-release-tag"/);

    // The publisher's own condition, not the precheck job's verifier clause.
    const noVerifierResult = mutate(
      source(DOCKER),
      "startsWith(github.ref, 'refs/tags/v') && needs.verify-release-tag.result == 'success' && ",
      "startsWith(github.ref, 'refs/tags/v') && ",
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
      expr(tagPushCondition),
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

describe('#1219 both publishing channels wait on the container precheck', () => {
  const precheckJob = (name: string) => {
    const text = source(name);
    const start = text.indexOf('\n  container-precheck:\n');
    return text.slice(start, text.indexOf('\n\n  ', text.indexOf('id: result', start)));
  };

  it('GHCR and the desktop release share one identical read-only precheck job', () => {
    expect(precheckJob(DOCKER)).toContain('node scripts/release-container-precheck.mjs');
    expect(precheckJob(DOCKER)).toBe(precheckJob(TAURI));
  });

  it.each(
    (
      [
        [
          'Tauri release without the precheck need',
          TAURI,
          'needs: [bundle, security-audit, verify-release-tag, container-precheck]',
          'needs: [bundle, security-audit, verify-release-tag]',
          /job "release" must need "container-precheck"/,
        ],
        [
          'GHCR build-push without the precheck need',
          DOCKER,
          'needs: [security-audit, verify-release-tag, container-precheck]',
          'needs: [security-audit, verify-release-tag]',
          /job "build-push" must need "container-precheck"/,
        ],
        [
          'Tauri release that ignores the precheck result',
          TAURI,
          `${containerPrecheckCondition} && `,
          '',
          /job "release" if: must require needs\.container-precheck\.result == 'success'/,
        ],
        [
          'GHCR build-push that ignores which commit was prechecked',
          DOCKER,
          ' && needs.container-precheck.outputs.prechecked-sha == github.sha',
          '',
          /prechecked-sha == github\.sha/,
        ],
        [
          'a precheck that can write to Actions',
          DOCKER,
          '      contents: read\n      actions: read\n',
          '      contents: read\n      actions: write\n',
          /must hold exactly permissions: \{ contents: read, actions: read \}/,
        ],
        [
          'a precheck that may fail without stopping the release',
          TAURI,
          '    timeout-minutes: 25\n',
          '    timeout-minutes: 25\n    continue-on-error: true\n',
          /job "container-precheck" must not set env, continue-on-error, container, services/,
        ],
        // #1234 review: the precheck runs tag code with an Actions token, so a tag push must prove the tag first.
        [
          'a precheck that does not wait for the tag verifier',
          DOCKER,
          '    needs: [verify-release-tag]\n    if: >-\n      ${{ always() && !cancelled() && ( github.event_name',
          '    if: >-\n      ${{ always() && !cancelled() && ( github.event_name',
          /job "container-precheck" must need verify-release-tag and run only on a dispatch or after the verifier proof/,
        ],
        [
          'a precheck that also runs for an unverified tag',
          TAURI,
          "( github.event_name == 'workflow_dispatch' || ( needs.verify-release-tag.result == 'success' && needs.verify-release-tag.outputs.verified-tag-sha == github.sha ) ) }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 25",
          "( github.event_name == 'workflow_dispatch' || github.event_name == 'push' ) }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 25",
          /job "container-precheck" must need verify-release-tag and run only on a dispatch or after the verifier proof/,
        ],
        [
          'a precheck whose timeout cancels it before its own wait ends',
          TAURI,
          '    runs-on: ubuntu-latest\n    timeout-minutes: 25\n',
          '    runs-on: ubuntu-latest\n    timeout-minutes: 1\n',
          /job "container-precheck" must set timeout-minutes: 25/,
        ],
        [
          'a precheck without a timeout',
          DOCKER,
          '    runs-on: ubuntu-latest\n    timeout-minutes: 25\n',
          '    runs-on: ubuntu-latest\n',
          /job "container-precheck" must set timeout-minutes: 25/,
        ],
        [
          'a precheck on a self-hosted runner that could forge its output',
          DOCKER,
          '    runs-on: ubuntu-latest\n    timeout-minutes: 25\n',
          '    runs-on: self-hosted\n    timeout-minutes: 25\n',
          /job "container-precheck" must run on the GitHub-hosted ubuntu-latest runner/,
        ],
        [
          'a precheck that swallows a failure',
          DOCKER,
          '--wait-seconds 1200 "$GITHUB_SHA"\n',
          '--wait-seconds 1200 "$GITHUB_SHA" || true\n',
          /job "container-precheck" must run exactly/,
        ],
        [
          'a precheck of a mutable ref instead of the exact commit',
          TAURI,
          `ref: ${expr('github.sha')}\n          persist-credentials: false\n\n      - name: Require a successful`,
          `ref: ${expr('github.ref')}\n          persist-credentials: false\n\n      - name: Require a successful`,
          /job "container-precheck" must run exactly/,
        ],
        [
          'a precheck output that does not come from the passed check',
          DOCKER,
          `prechecked-sha: ${expr('steps.result.outputs.prechecked-sha')}`,
          `prechecked-sha: ${expr('github.sha')}`,
          /must expose only prechecked-sha from its result step/,
        ],
        [
          'a precheck step with a shell override',
          TAURI,
          `GH_TOKEN: ${expr('github.token')}\n`,
          `GH_TOKEN: ${expr('github.token')}\n        shell: sh\n`,
          /job "container-precheck" must run exactly/,
        ],
      ] as const
    ).map(([label, name, from, to, message]) => ({ label, name, from, to, message })),
  )('$label fails', ({ name, from, to, message }) => {
    expect(messages(name, mutate(source(name), from, to))).toMatch(message);
  });

  // #1234 review: workflow-level defaults reach the precheck that holds GH_TOKEN, past the job-level checks.
  it.each([
    [DOCKER, 'shell: sh'],
    [DOCKER, 'working-directory: alt'],
    [TAURI, 'shell: sh'],
    [TAURI, 'working-directory: alt'],
  ])('%s with workflow-level defaults (%s) fails', (name, setting) => {
    const text = source(name).replace(
      '\njobs:\n',
      `\ndefaults:\n  run:\n    ${setting}\n\njobs:\n`,
    );
    expect(text).toContain('\ndefaults:\n');
    expect(messages(name, text)).toMatch(/must not define workflow-level defaults/);
  });

  it.each([
    [DOCKER, '  build-push:\n'],
    [TAURI, '  release:\n'],
  ])('%s without the precheck job fails', (name, publisher) => {
    const text = source(name);
    const start = text.indexOf('  container-precheck:\n');
    const next = text.indexOf(publisher, start);
    expect(start).toBeGreaterThan(0);
    expect(next).toBeGreaterThan(start);
    expect(messages(name, text.slice(0, start) + text.slice(next))).toMatch(
      /missing job "container-precheck"/,
    );
  });
});

describe('#1206 Tauri release trusts only the pinned-verifier proof', () => {
  const releaseWith = (condition: string) =>
    mutate(source(TAURI), expr(tauriReleaseCondition), expr(condition));
  const withoutPart = (part: string) => releaseWith(tauriReleaseCondition.replace(part, ''));
  const releaseCheckout = (ref: string) =>
    `- name: Check out the exact audited commit\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${expr(ref)}`;

  // The bundle job's checkout with its exact-ref line (`true`), without a ref (`false`), or with another ref expression.
  const bundleCheckout = (ref: string | boolean) => {
    const refLine =
      ref === false ? '' : `          ref: ${expr(ref === true ? 'github.sha' : ref)}\n`;
    return `${refLine}          persist-credentials: false\n      # QNBS-v3: composite action`;
  };

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
          'needs: [bundle, security-audit, verify-release-tag, container-precheck]',
          'needs: [bundle, security-audit, container-precheck]',
        ),
      /job "release" must need "verify-release-tag"/,
    ],
    [
      'a release that checks out the mutable tag ref',
      () => mutate(source(TAURI), releaseCheckout('github.sha'), releaseCheckout('github.ref')),
      /job "release" must check out ref/,
    ],
    [
      'a bundle without the verifier dependency',
      () =>
        mutate(
          source(TAURI),
          'needs: [verify-release-tag, parity-preflight]',
          'needs: [parity-preflight]',
        ),
      /job "bundle" must need "verify-release-tag"/,
    ],
    [
      'a bundle that ignores the verified tag target',
      () =>
        mutate(
          source(TAURI),
          ' &&\n            needs.verify-release-tag.outputs.verified-tag-sha == github.sha',
          '',
        ),
      /job "bundle" if: must equal the exact fail-closed condition/,
    ],
    [
      'a bundle that ignores the verifier result',
      () =>
        mutate(source(TAURI), "needs.verify-release-tag.result == 'success' &&\n            ", ''),
      /job "bundle" if: must equal the exact fail-closed condition/,
    ],
    [
      'a bundle with an extra unconditional branch',
      () =>
        mutate(
          source(TAURI),
          "github.event_name == 'workflow_dispatch' ||\n          (",
          "github.event_name == 'workflow_dispatch' || true ||\n          (",
        ),
      /job "bundle" if: must equal the exact fail-closed condition/,
    ],
    [
      'a bundle that skips the plugin parity result',
      () => mutate(source(TAURI), "        needs.parity-preflight.result == 'success' &&\n", ''),
      /job "bundle" if: must equal the exact fail-closed condition/,
    ],
    [
      'a bundle that checks out the default ref',
      () => mutate(source(TAURI), bundleCheckout(true), bundleCheckout(false)),
      /job "bundle" must check out ref/,
    ],
    [
      'a bundle that checks out the mutable tag ref',
      () => mutate(source(TAURI), bundleCheckout(true), bundleCheckout('github.ref')),
      /job "bundle" must check out ref/,
    ],
    [
      'a verifier that is not pinned to trusted code',
      () => mutate(source(TAURI), `ref: ${trustedVerifierSha}`, `ref: ${expr('github.ref_name')}`),
      /immutable trusted verifier/,
    ],
    [
      'a verifier job that a manual dispatch can start',
      () =>
        mutate(
          source(TAURI),
          expr(tagPushCondition),
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
          'needs: [bundle, security-audit, verify-release-tag, container-precheck]',
          'needs: [bundle, verify-release-tag, container-precheck]',
          /must need "security-audit"/,
        ],
        [
          'GHCR build-push without the audit need',
          DOCKER,
          'needs: [security-audit, verify-release-tag, container-precheck]',
          'needs: [verify-release-tag, container-precheck]',
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
