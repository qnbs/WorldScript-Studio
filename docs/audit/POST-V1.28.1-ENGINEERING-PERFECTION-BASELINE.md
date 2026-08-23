# Post-v1.28.1 engineering perfection baseline

Status: H0 forensic baseline captured on 2026-08-23. This document is an evidence ledger, not a
claim that the later H1–H8 workstreams are complete.

## Evidence boundary and provenance

The historical release boundary remains immutable. Local Git facts below were checked in the
checkout at capture time. Release publication, branch protection, issue/PR state, and hosted CI
facts are transcribed from [`RELEASE-V1.28.1-EVIDENCE.md`](../RELEASE-V1.28.1-EVIDENCE.md), which
was the completed release checkpoint. A fresh remote/API read in the authorized context confirmed
the current main, protection, issue, and PR facts below. The restricted sandbox still cannot be
used for PR-producing work; the cause and preflight are in the reliability record.

The complete Git/GitHub access diagnosis and safe recovery procedure is recorded in
[`GIT-GITHUB-ACCESS-RELIABILITY.md`](GIT-GITHUB-ACCESS-RELIABILITY.md). The failure was caused by
the restricted execution environment's `.git` mount, keyring, and network policy; no repository
permission or Git configuration repair was justified.

| Evidence | Captured value | Source / interpretation |
| --- | --- | --- |
| Current local `main` commit | `2d63a91dcda5d094a7573bff8ae3f723a21bebfa` | `git rev-parse HEAD`; local `origin/main` points at the same commit |
| Current local main tree | `2d36d20bae5dfc533cd3000c4bcb6f253d6e9857` | `git rev-parse HEAD^{tree}` |
| Historical release tag | `v1.28.1` | Annotated tag is present locally |
| Release tag object / target | `78e6e19168b86b810952f3db7fe092a8dfed168b` / `b6c40aa322d56a7e8c337d02394b52962f1e6ef6` | `git rev-parse v1.28.1` and `v1.28.1^{};` release ledger independently records GitHub verification |
| Release assets | 14 non-empty assets | Published-release ledger; no asset is being changed |
| Application version | `1.28.1` | `package.json`, release ledger |
| Branch protection | Required signatures; exactly `✅ CI Success`; conversation resolution; force-pushes and deletions disabled | Live API read in authorized context |
| Remote PR state | 0 open PRs | Live `gh pr list` |
| Remote issue state | 16 open issues | Live `gh issue list` |

The preserved untracked `.worktrees/` and `recovery-artifacts/` directories are intentionally not
part of this change and must remain intact.

## Release and security truth

The v1.28.1 publication contains Linux, Windows, and macOS ARM artifacts and no
`darwin-x86_64` updater entry. The release ledger explicitly does not claim independent
cryptographic verification of updater signatures because the installed Tauri CLI exposes signing
but no artifact-verification command, and neither `minisign` nor `signify` is installed. This is an
H1-E evidence gap only; it is not being retroactively filled or conflated with source/tag
verification.

The release is not being renamed or republished. No Intel asset, tag rewrite, `latest.json`
mutation, release-note rewrite, v1.28.2 work, #332/#341 remediation, production Qt UI, GPUI,
licensing work, or unrelated product work belongs in H0.

## Toolchain and workflow baseline

| Area | Current evidence |
| --- | --- |
| Node / pnpm | Node `v24.11.1` in this workstation; repository requires Node `>=22.0.0`; pnpm `11.22.0` |
| Type checking | `tsgo`, one-checker local gate and four-checker CI command |
| CI quality matrix | Node 22 and Node 24; no measurement-backed Node 26 lane yet |
| Required aggregation | `✅ CI Success` uses `if: always()` and fails closed for security, signatures, quality, changes, native, build, E2E, Lighthouse, and VRT |
| Advisory jobs | Storybook and deep E2E are job-level advisory while stability evidence is collected; this is policy, not yet a 30–50-run measurement conclusion |
| Local quality policy | `pnpm run ci:prepush`; full coverage, E2E, Lighthouse, Storybook test-runner, mutation, and native packaging remain cloud work |
| Desktop matrix | `macos-latest` is the existing ARM release producer; current workflow comments say Intel hosting is unavailable and no Intel qualification workflow exists yet |
| Rust Core | `crates/worldscript-project` is renderer-neutral schema/validation/migration work and is shadow-called by one typed Tauri command; R-15 storage architecture is not yet implemented |
| Scenario | The existing Scenario workspace uses the canonical `StoryProject` projection; no secondary screenplay persistence model is authorized |

The release checkpoint records one expanded-scope coverage measurement of lines 81.63%, functions
74.26%, branches 67.75%, and statements 79.55% (Node 22 and Node 24 matched there), with configured
floors of lines 80%, functions 72%, branches 66%, and statements 78%. It does not constitute the
required representative H1-A sample. The release checkpoint documented 6,951+ tests across 574
files; the H0 regression test raises the source-synchronized projection to 6,954+ tests across
575 files. Neither is a replacement for the exact hosted count and 30–50-run timing sample required
in H1-A.

Mutation policy remains `break: 75`, `low: 70`, and `high: 85`; no new score is claimed here.
i18n remains 19 locales and 2,925 keys at the release checkpoint. Full bundle, E2E, Storybook,
Lighthouse, and mutation evidence remains CI-owned.

## Suppression forensic correction

Before H0, the recursive scanner traversed arbitrary descendants of the checkout root. In this
checkout that included preserved copied worktrees and produced the following reproducible
discrepancy:

```text
raw local recursive traversal:       144 suppression directives
authoritative Git-tracked source:     48 suppression directives
tracked TypeScript/TSX files:        1256 files
tracked paths under preserved copies:   0
committed ratchet baseline:           48 directives
```

The scanner now obtains its source universe from `git ls-files -z -- '*.ts' '*.tsx'` and then reads
only existing tracked files. The collector is injectable for deterministic tests. This gives the
following invariants:

1. tracked real suppressions are counted;
2. copied `.worktrees/` and `recovery-artifacts/` files are not discovered merely because they are
   descendants of the checkout;
3. arbitrary untracked copied source is not counted;
4. the baseline remains 48 until a real tracked suppression is removed; and
5. a newly tracked suppression still exceeds the ratchet and fails the gate.

The shell evidence above was used because this sandbox prevents Node from spawning Git with
`child_process.execFileSync` (it returns `EPERM` despite the Git process producing status-0
output). Hosted CI is expected to exercise the normal Node CLI path; this local execution caveat
is recorded rather than weakening the production invariant.

The bundle checker has a separate stale assumption: when `dist/assets` is absent it prints a
warning and exits successfully. H0 records that behavior but does not broaden this PR into H2-C;
the fail-closed budget change belongs to the dedicated bundle-budget workstream.

## Stale-assumption corrections

- A recursive suppression count is not a source-of-truth metric when preserved copies exist. The
  tracked-source count is authoritative.
- Node 22/24 duplication, a possible Node 26 lane, and advisory-job promotion require measured
  wall-clock, critical-path, cache, failure, and unique-defect evidence before workflow changes.
- The current Intel comments describe an unavailable production runner, not a completed Intel
  qualification. H1-D/E must add a non-publishing, exact-ref qualification path before any
  promotion discussion.
- Tauri updater signing, application code signing, notarization, and independent artifact
  verification are separate controls. The release evidence proves only the claims it names.
- Rust Core extraction has started but is not R-15 secure storage. A typed transitional command is
  not permission to implement renderer-specific crypto or a generic command executor.
- Scenario's canonical projection is an architectural constraint; H6 may close verified UI gaps
  only through that projection.

## Dependency order and acceptance gates

```text
H0 forensic baseline
 ├─ H1-A CI measurements ─ H1-B DAG/lane evidence ─ H1-C build authority ─ H2-C budgets
 ├─ H1-D/H1-E Intel qualification ─ separate evidence-backed promotion PR
 ├─ H2-A coverage     H2-B suppression     H2-D locale policy
 ├─ H3 privacy truth ─ H4 renderer-neutral Rust Core
 ├─ H5 vendor/trust evidence
 ├─ H6 Scenario projection gap audit
 └─ H7 native killer-gate reconciliation
H4 packaged evidence ─ future core/native migration and Qt G2 technical readiness
H8 reconciliation ─ field evidence ─ only then future #332/#341 and formal G2 decisions
```

H0 exits when the pre-change evidence is preserved, the tracked-source result is reproducible,
scanner regression tests pass, the suppression CLI passes in a normal Git-capable environment,
remote issue/workflow facts are refreshed, and each later PR has explicit dependencies and
acceptance criteria. No H1–H8 completion is implied by this baseline.

## Residual risks at the checkpoint

- Hosted remote state and the complete CI run sample still need a fresh read.
- The independent updater-signature verifier remains unavailable.
- The bundle budget skips when expected output is absent.
- Intel qualification, effective macOS deployment-target proof, and release-signing compatibility
  are unproved.
- R-15 secure storage, hostile plugin runtime admission, strict collaboration revocation, and Qt
  lifecycle/accessibility gates remain future work.
- The local `.git` directory is read-only in this execution environment, so a signed branch,
  commit, PR, push, hosted CI run, and merge ledger cannot be created here.
