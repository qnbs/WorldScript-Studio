# Post-v1.28.1 perfection program state

This is the durable resume ledger for the post-release engineering program. It deliberately
separates locally implemented evidence from hosted or merge-dependent evidence.

## Current state

| Field | Value |
| --- | --- |
| Program boundary | Post-v1.28.1; immutable release boundary preserved |
| Current stage | H1-A signal/timing/cache/rerun evidence integrated for the observable sample; H1-E updater-payload verification `PASS`; H1-D Intel qualification workflow is present but unexecuted/not promoted; H1-F0 governance inventory active; H0 remains complete |
| Local state | This branch adds only non-publishing H1-D qualification workflow/docs. The original 50-run sample and separate post-#473 through post-#476 checkpoints remain immutable; no Node lane, required-status, DAG, build authority, release, or advisory policy change made |
| Last reconciled main checkpoint | `5806bd7ec6566661e575833f13f86b8e192f0ff4` (post-#490 verified main at the recorded checkpoint; not a perpetual live-main claim) |
| Latest completed PR / branch | PR #490 merged from `h1-e-updater-verification-evidence`; final PR head `014a3942595f84d4c36ab6de2281d4ff866a3d73` |
| Latest completed merge | `5806bd7ec6566661e575833f13f86b8e192f0ff4`; resulting tree `e10d9c87cb32b0bac2f8835b0315af911f43c814`; merged `2026-08-24T02:32:42Z` |
| Hosted CI / CodeQL / Security | PR #490 final head `014a3942…` merged normally; fresh main CI `32683407818` and CodeQL `32683407903` succeeded on merge SHA `5806bd7e…`, including `✅ CI Success`; historical sample rerun count is 0 and historical cache distribution remains `UNKNOWN` |
| Affected issues | None claimed closed or remediated by H0 |
| Release impact | None; no tag, release, updater metadata, or published asset changed; H1-E independently verified the three published updater payloads without private-key access |

The Git/GitHub access root cause and preflight are recorded in
[`GIT-GITHUB-ACCESS-RELIABILITY.md`](GIT-GITHUB-ACCESS-RELIABILITY.md). The repository itself did
not require a permission, lock, worktree, hook, signing, remote, or global-config repair.

Live repository state is never inferred from a stored checkpoint in this ledger. Re-query GitHub
and `origin` before execution decisions; completed stage evidence remains immutable even when a
later merge advances `main`.

## H0 acceptance ledger

| Acceptance criterion | Evidence | Status |
| --- | --- | --- |
| Record pre-change raw and authoritative counts | `144` raw recursive directives; `48` Git-tracked directives; recorded in the H0 baseline | ✅ |
| Use Git-tracked source as scanner universe | `scripts/suppression-scanner.mjs` uses injectable `git ls-files` collection | ✅ implementation |
| Count tracked real suppression | `pnpm exec vitest run tests/unit/tooling/suppressionScanner.test.ts` — 3/3 passed; authorized-context CLI reports 48 across 1,257 current tracked files | ✅ |
| Ignore preserved copies and arbitrary untracked source | Same 3/3 test run plus zero tracked paths under both preserved directories | ✅ |
| Keep baseline at 48 | `suppressions-baseline.json` unchanged; authorized-context CLI count is 48 (pre-change tracked-source count was 1,256; current count is 1,257 after the new test) | ✅ |
| Fail on newly tracked suppression | Existing ratchet comparison retained; authorized-context CLI reports 48/48 and passes | ✅ current gate |
| Reconcile remote issue/workflow facts | Initial authorized reads: 0 open PRs and 16 open issues; PR #469 subsequently merged normally; latest main CI and CodeQL green | ✅ |
| Reconcile remote main and protection | `origin/main` = `476c0ce5…`; squash commit GitHub verification was `verified=true`, `reason=valid`; required signatures, exact `✅ CI Success`, conversation resolution, force-push prohibition, and deletion prohibition remained unchanged | ✅ |
| Provide next-PR dependencies and acceptance criteria | H0 baseline dependency graph and this ledger | ✅ |

## PR ledger

The completed H0 PR is recorded here with its final head and immutable post-merge evidence:

| Stage | PR | Head | Merge SHA | Main after merge | CI / security evidence | Next exact task |
| --- | --- | --- | --- | --- | --- | --- |
| H0 | #469 | `3a140cb3a019b83e643aef5b5d67a8937c790691` | `476c0ce5adf33302b65bb77391835813017a62fc` | `476c0ce5adf33302b65bb77391835813017a62fc` / tree `49919d853814a863194a6918058349e0931fdd34` | PR CI `32629355521`; post-merge main CI `32630810142`; CodeQL `32630810130`; all five material review threads resolved | Begin H1-A measurement from a fresh verified-main branch; run H1-F0 evidence inventory alongside it |

The PR should contain only the H0 baseline documents, the scanner extraction, and its focused
regression test. It should not change `suppressions-baseline.json`, workflow lanes, product
behavior, release metadata, or preserved artifacts.

The first evidence-only H1 slice is also recorded with immutable evidence. Its merge advanced
`main` and therefore does not make any stored SHA a live-state claim:

| Stage | PR | Head | Merge SHA | Main after merge | CI / security evidence | Next exact task |
| --- | --- | --- | --- | --- | --- | --- |
| H1-A / H1-F0 evidence | #471 | `6cf9780a9b0a43c6a8a8802b6b93727d162ebab4` | `391dc506fb654d0ea289edb426c633782d141efe` | `391dc506fb654d0ea289edb426c633782d141efe` / tree `a9ee707c6ac497e22509efae8c822a2f6a257503` | PR CI `32636290349`; post-merge main CI `32637402322`; CodeQL `32637402303`; all five material review threads resolved; CodeRabbit rate-limited, Sourcery/DeepSource skipped | Classify sampled failures/cancellations and unique lane/advisory signal before any H1-B/DAG decision |
| H1-A measurement evidence | #472 | `87d8273c02f9598d3f37a2d5c6280fcfcc017228` | `5f4cd85faf853370a958955e88a0f3afebc03907` | `5f4cd85faf853370a958955e88a0f3afebc03907` / tree `da90504d11857359ed167ce6f48af8d3a3c1be6e` | PR CI `32640865997`; post-merge main CI `32642666084`; CodeQL `32642666044`; current-head review threads resolved; squash commit GitHub Verified | Classify sampled failures/cancellations and unique lane/advisory signal before any H1-B/DAG decision |
| H1-A failure/signal evidence | #473 | `41099f89b1617ac646d78a415609a8e0b32b7ade` | `a536aeebc09f97b45a3094e05c51dfa8e32922df` | `a536aeebc09f97b45a3094e05c51dfa8e32922df` / tree `9cd48b1c78104eb75fcf782431819e4d58935d89` | PR CI `32646942326`; post-merge main CI `32648286172`; CodeQL `32648286205`; 9 failures and 15 cancellations classified; unique signal remains `UNKNOWN` | Preserve the separate post-#473 checkpoint and do not advance H1-B without unique-signal authority evidence |
| H1-A checkpoint reconciliation | #474 | `d53aabfd9c3d06bd7c02610127548352d6d9b2da` | `8223d04e0b51443c6490695b0d08a4189bffe3ee` | `8223d04e0b51443c6490695b0d08a4189bffe3ee` / tree `6ab3a6143f872be2da2e1509225deca759b0bc7f` | PR CI `32652726821`; PR CodeQL `32652726773`; post-merge main CI `32654048692`; CodeQL `32654048709`; corrected ledger checkpoint, fresh main run ~22m17s, cache hits recorded, GitHub Verified | Continue H1-A evidence only where it can classify unique signal or historical cache/rerun behavior; do not advance H1-B/DAG authority |
| H1-A post-#475 checkpoint evidence | #475 | `c088318c4c434b5e2238ce26db1804e290b4f493` | `3378fa4327e79bb77bcd98e1213dfe56acaefd09` | `3378fa4327e79bb77bcd98e1213dfe56acaefd09` / tree `d09334ae0e691d5d5cef8f214717a50634946f68` | PR CI `32655915753`; PR CodeQL `32655915784`; post-merge main CI `32657261089`; CodeQL `32657261084`; fresh main run ~23m09s, explicit cache hits, GitHub Verified | Preserve original sample and separate checkpoints; historical cache distribution and unique signal remain `UNKNOWN`; do not advance H1-B/DAG authority |
| H1-A post-#476 checkpoint and rerun reconciliation | #476 | `84b5c187ab2040b1edcc7418ae6ee46ee324ffa1` | `fdd60c9465d7515dabc713d4e11f8ff2662fc5c4` | `fdd60c9465d7515dabc713d4e11f8ff2662fc5c4` / tree `f0d24290765c4eb5e132941b2472117e7cfc3316` | PR CI `32659129361`; PR CodeQL `32659129403`; post-merge main CI `32660607709`; CodeQL `32660607683`; fresh main run ~22m29s, explicit cache hits, GitHub Verified; all 50 original sample IDs are run attempt 1 | Treat sample-scoped rerun count as 0; retain historical cache distribution and unique signal as `UNKNOWN`; no H1-B/DAG authority decision |
| H1-E updater payload verification | #490 | `014a3942595f84d4c36ab6de2281d4ff866a3d73` | `5806bd7ec6566661e575833f13f86b8e192f0ff4` | `5806bd7ec6566661e575833f13f86b8e192f0ff4` / tree `e10d9c87cb32b0bac2f8835b0315af911f43c814` | PR CodeQL and required CI green; fresh main CI `32683407818`, CodeQL `32683407903`; squash commit GitHub Verified; 3 positive and 3 negative manifest-fed verifier cases; all material review threads resolved | Execute non-publishing H1-D Intel qualification on exact refs; do not promote production support from workflow presence alone |

## Next exact resume procedure

1. Preserve the original 50-run sample and the separate `POST_MERGE_CHECKPOINT` evidence for
   #473, #474, #475, and #476; all 50 sample runs and all four checkpoints are first attempts
   (`run_attempt=1`). The original sample therefore has 0 observed reruns.
2. Preserve the observed Node-22/24 overlap, explicit cache hits on all four post-merge checkpoints,
   historical cache `UNKNOWN`, and the `UNKNOWN` downstream unique-signal state; do not infer a
   lane decision from timing or correlated outcomes alone.
3. Keep H1-F0 inventory current and defer H1-F1 canonicalization until H1-A through H1-E decisions
   are measured and verified; carry the H1-F DevOps operating-model augmentation as binding.
4. Preserve [`H1-E-UPDATER-VERIFICATION-REPORT.md`](H1-E-UPDATER-VERIFICATION-REPORT.md): the
   production-compatible `minisign-verify 0.2.5` harness passed all three positive and three
   negative tests. H1-E is complete for updater-payload verification; platform code-signing,
   notarization, and Intel qualification remain separate evidence questions.
5. H1-D workflow presence is not qualification evidence. Dispatch it only on exact refs, inspect
   both runner results, and require three clean independent `macos-15-intel` candidate runs before
   any future `darwin-x86_64` promotion decision; `macos-26-intel` remains advisory.

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
| Historical `pnpm run ci:prepush` before change-aware admission | Exit 0; all sequential low-end checks passed on the earlier H1-D working tree |
| Change-aware local admission recovery | Direct `node scripts/ci-prepush-lowend.mjs` passed on the current H1-D working tree as `NON_CODE_ONLY`; policy guards passed; TypeScript was explicitly `DEFERRED_TO_REQUIRED_CI`; no full-project `tsgo` launched. The `pnpm run ci:prepush` wrapper remains unavailable in this sandbox because pnpm cannot open its SQLite store / reports lockfile verification before invoking the script. |
| Hosted CI / PR / signing | PR #469 final head was GitHub Verified and all five material review threads were resolved; PR CI `32629355521` passed; fresh main CI `32630810142` and CodeQL `32630810130` passed; normal protected squash merge produced GitHub Verified commit `476c0ce5…` |
| H1-A measurement report | Historical replay reconciled omitted success `32613719445`; PR #472 integrated 50 unique runs with 26/9/15 outcomes and explicit skipped advisory jobs; fresh main evidence is green; no lane/DAG policy change |
| H1-A failure/signal report | 9 first-attempt failures classified into four root-cause classes; 15 first-attempt cancellations classified as concurrency supersession by same-branch chronology; 0 lane-exclusive failures; advisory failure signal 0, unique signal `UNKNOWN`; post-#473 checkpoint `32648286172` successful with explicit checkpoint cache hits |

## Program stop/go constraints

H0 is complete. H1-A measurement is integrated and failure/cancellation evidence is classified, but
its lane decision remains pending: the sample shows substantial Node-22/24 overlap and no
lane-exclusive failure, while unique defect signal remains `UNKNOWN`. H1-E is `PASS` for independent
updater-payload verification through the production-compatible verifier; platform code-signing and
notarization remain separate. Residual risks carried forward are fail-closed bundle-budget work
deferred to H2-C, Intel qualification, and the later
R-15/native, plugin, collaboration, Scenario, and Qt evidence gates.
The restricted Codex sandbox incident remains an execution-environment limitation, not repository
corruption; the authorized writable context completed the signed branch/commit/push and GitHub
verification sequence. Stop and re-plan if a later stage discovers a release-boundary mutation,
weakened branch protection or signing, a suppression count that cannot be explained by tracked-source
state, or a mismatch between remote `main` and this ledger. H1–H8 remain dependency-ordered.
