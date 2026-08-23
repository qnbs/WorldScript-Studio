# Post-v1.28.1 perfection program state

This is the durable resume ledger for the post-release engineering program. It deliberately
separates locally implemented evidence from hosted or merge-dependent evidence.

## Current state

| Field | Value |
| --- | --- |
| Program boundary | Post-v1.28.1; immutable release boundary preserved |
| Current stage | H0 — forensic baseline and tracked-source suppression correction |
| Local state | Implementation, access-reliability record, focused tests, typecheck, and complete pre-push gate passed |
| Current main | `2d63a91dcda5d094a7573bff8ae3f723a21bebfa` (H0 branch is based here) |
| PR / branch | Active H0 PR #469 / `chore/post-v1.28.1-h0-baseline` (correction pass in progress; head intentionally not duplicated here) |
| Merge SHA | Not applicable |
| Hosted CI / CodeQL / Security | Main baseline CI `32619581413` and CodeQL `32619581426` are green; the original H0-head results are historical and the correction-head CI is pending |
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
| Count tracked real suppression | `pnpm exec vitest run tests/unit/tooling/suppressionScanner.test.ts` — 3/3 passed; authorized-context CLI reports 48 across 1,257 current tracked files | ✅ |
| Ignore preserved copies and arbitrary untracked source | Same 3/3 test run plus zero tracked paths under both preserved directories | ✅ |
| Keep baseline at 48 | `suppressions-baseline.json` unchanged; authorized-context CLI count is 48 (pre-change tracked-source count was 1,256; current count is 1,257 after the new test) | ✅ |
| Fail on newly tracked suppression | Existing ratchet comparison retained; authorized-context CLI reports 48/48 and passes | ✅ current gate |
| Reconcile remote issue/workflow facts | Initial authorized reads: 0 open PRs and 16 open issues; current H0 PR #469 is open; latest main CI and CodeQL green | ✅ |
| Reconcile remote main and protection | `origin/main` = `2d63a91d…`, GitHub Verified; current H0 PR #469 and 16 open issues; signatures and `✅ CI Success` protection intact | ✅ |
| Provide next-PR dependencies and acceptance criteria | H0 baseline dependency graph and this ledger | ✅ |

## PR ledger

The active H0 PR is tracked here without duplicating its mutable correction head SHA:

| Stage | PR | Head | Merge SHA | Main after merge | CI / security evidence | Next exact task |
| --- | --- | --- | --- | --- | --- | --- |
| H0 | #469 | `chore/post-v1.28.1-h0-baseline` | pending | `2d63a91d…` before merge | Original head was verified; correction-head hosted refresh pending | Finish the bounded review-correction cycle, verify the new signed head and complete CI/review set, then use the normal protected merge and record post-merge SHAs |

The PR should contain only the H0 baseline documents, the scanner extraction, and its focused
regression test. It should not change `suppressions-baseline.json`, workflow lanes, product
behavior, release metadata, or preserved artifacts.

## Next exact resume procedure

1. Finish the bounded correction in PR #469 from the authorized writable Git environment.
2. Verify the new signed head, focused suppression test, `node scripts/check-suppressions.mjs`,
   direct `tsgo`, and sequential `pnpm run ci:prepush`; expect 48 and no baseline update.
3. Wait for the new head's complete required and advisory hosted CI/review set; do not reuse the
   original head's results.
4. After normal protected merge and post-merge main verification, add the merge SHA, resulting
   main SHA, run IDs, acceptance result, and residual risk here.
5. Only then start H1-A measurements from a representative 30–50-run hosted sample. Do not
   change Node lanes, required status authority, advisory status, or build semantics before that
   measurement.

## Verification record for the current working tree

| Check | Result |
| --- | --- |
| Targeted suppression Vitest | 3 tests passed |
| Biome on changed scanner/test files | Passed |
| `git diff --check` | Passed |
| Suppression ratchet | Authorized-context CLI passed: 48 / baseline 48 across 1,257 current tracked source files; pre-change count was 1,256; restricted sandbox Node Git collection was EPERM and shell-derived evidence was 48 |
| i18n parity, bundle rebuild, content guard, translation quality | Passed: 19 locales, 2,925 keys |
| Release/doc truth | Passed after source-synchronized metric update: 7 files match |
| CSP, desktop import boundary, native readiness | Passed |
| Direct single-checker `tsgo` | Exit 0; no diagnostics |
| `pnpm run ci:prepush` | Exit 0; all sequential low-end checks passed |
| Hosted CI / PR / signing | Three authorized preflight probes passed; PR #469 exists; correction-head hosted verification is pending |

## Program stop/go constraints

Stop and re-plan if H0 discovers a release-boundary mutation, weakened branch protection or
signing, a suppression count that cannot be explained by tracked-source state, or a mismatch between
remote `main` and this ledger. H1–H8 remain dependency-ordered; missing updater verification blocks
only its independent-verification claim, not unrelated evidence work.
