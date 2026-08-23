# Post-v1.28.1 perfection program state

This is the durable resume ledger for the post-release engineering program. It deliberately
separates locally implemented evidence from hosted or merge-dependent evidence.

## Current state

| Field | Value |
| --- | --- |
| Program boundary | Post-v1.28.1; immutable release boundary preserved |
| Current stage | H0 — forensic baseline and tracked-source suppression correction |
| Local state | Implementation, access-reliability record, focused tests, typecheck, and complete pre-push gate passed |
| Current main | `2d63a91dcda5d094a7573bff8ae3f723a21bebfa` |
| PR / branch | Not created: `.git` is read-only in the current execution environment |
| Merge SHA | Not applicable |
| Hosted CI / CodeQL / Security | Main baseline CI `32619581413` and CodeQL `32619581426` are green; H0 PR CI is pending |
| Affected issues | None claimed closed or remediated by H0 |
| Release impact | None; no tag, release, updater metadata, or published asset changed |

The Git/GitHub access root cause and preflight are recorded in
[`GIT-GITHUB-ACCESS-RELIABILITY.md`](GIT-GITHUB-ACCESS-RELIABILITY.md). The repository itself did
not require a permission, lock, worktree, hook, signing, remote, or global-config repair.

## H0 acceptance ledger

| Acceptance criterion | Evidence | Status |
| --- | --- | --- |
| Record pre-change raw and authoritative counts | `144` raw recursive directives; `48` Git-tracked directives; recorded in the H0 baseline | ✅ |
| Use Git-tracked source as scanner universe | `scripts/suppression-scanner.mjs` uses injectable `git ls-files` collection | ✅ implementation |
| Count tracked real suppression | `pnpm exec vitest run tests/unit/tooling/suppressionScanner.test.ts` — 3/3 passed | ✅ |
| Ignore preserved copies and arbitrary untracked source | Same 3/3 test run plus zero tracked paths under both preserved directories | ✅ |
| Keep baseline at 48 | `suppressions-baseline.json` unchanged; shell count is 48 | ✅ |
| Fail on newly tracked suppression | Existing ratchet comparison retained; end-to-end CLI reports 48/48 and passes | ✅ current gate |
| Reconcile remote issue/workflow facts | Live authorized reads: 0 open PRs, 16 open issues, latest main CI and CodeQL green | ✅ |
| Reconcile remote main and protection | `origin/main` = `2d63a91d…`, GitHub Verified; 0 open PRs, 16 open issues; signatures and `✅ CI Success` protection intact | ✅ |
| Provide next-PR dependencies and acceptance criteria | H0 baseline dependency graph and this ledger | ✅ |

## PR ledger

No PR entry can be created until a writable Git metadata directory is available. The intended first
PR is:

| Stage | PR | Head | Merge SHA | Main after merge | CI / security evidence | Next exact task |
| --- | --- | --- | --- | --- | --- | --- |
| H0 | pending | pending signed commit | pending | `2d63a91d…` before merge | pending hosted refresh | Create a signed feature branch from fast-forwarded verified `main`, commit H0, push, run the complete `ci:prepush` gate and hosted required/advisory jobs, then refresh the remote-state row |

The PR should contain only the H0 baseline documents, the scanner extraction, and its focused
regression test. It should not change `suppressions-baseline.json`, workflow lanes, product
behavior, release metadata, or preserved artifacts.

## Next exact resume procedure

1. In the authorized writable Git environment documented by the access-reliability record, fetch
   `origin`, verify `main` is fast-forwarded to the remote, verify GitHub signatures and required
   `✅ CI Success`, and create a fresh signed H0 branch.
2. Run the focused suppression test and `node scripts/check-suppressions.mjs`; expect 48 and no
   baseline update.
3. Run `pnpm run ci:prepush` sequentially. Push only after the gate and the repository signing
   hooks succeed.
4. Capture hosted CI, CodeQL, Security, and remote issue/PR state. Add the resulting PR number,
   signed head, merge SHA, main SHA, run IDs, acceptance result, and residual risk here after the
   protected merge.
5. Start H1-A measurements from a representative 30–50-run hosted sample. Do not change Node
   lanes, required status authority, advisory status, or build semantics before that measurement.

## Verification record for the current working tree

| Check | Result |
| --- | --- |
| Targeted suppression Vitest | 3 tests passed |
| Biome on changed scanner/test files | Passed |
| `git diff --check` | Passed |
| Suppression ratchet | Passed: 48 / baseline 48 across 1,256 tracked source files |
| i18n parity, bundle rebuild, content guard, translation quality | Passed: 19 locales, 2,925 keys |
| Release/doc truth | Passed after source-synchronized metric update: 7 files match |
| CSP, desktop import boundary, native readiness | Passed |
| Direct single-checker `tsgo` | Exit 0; no diagnostics |
| `pnpm run ci:prepush` | Exit 0; all sequential low-end checks passed |
| Hosted CI / PR / signing | Three authorized preflight probes passed; H0 PR-producing verification is in progress |

## Program stop/go constraints

Stop and re-plan if H0 discovers a release-boundary mutation, weakened branch protection or
signing, a suppression count that cannot be explained by tracked-source state, or a mismatch between
remote `main` and this ledger. H1–H8 remain dependency-ordered; missing updater verification blocks
only its independent-verification claim, not unrelated evidence work.
