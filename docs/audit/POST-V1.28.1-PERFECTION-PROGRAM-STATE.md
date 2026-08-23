# Post-v1.28.1 perfection program state

This is the durable resume ledger for the post-release engineering program. It deliberately
separates locally implemented evidence from hosted or merge-dependent evidence.

## Current state

| Field | Value |
| --- | --- |
| Program boundary | Post-v1.28.1; immutable release boundary preserved |
| Current stage | H1-A measurement evidence + H1-F0 governance inventory active; H0 remains complete |
| Local state | H1-A 50-run CI evidence report captured on a fresh verified-main branch; no Node lane, required-status, DAG, build, or advisory policy change made |
| Last reconciled main checkpoint | `391dc506fb654d0ea289edb426c633782d141efe` (post-#471 verified main; not a perpetual live-main claim) |
| PR / branch | PR #469 merged from `chore/post-v1.28.1-h0-baseline`; final PR head `3a140cb3a019b83e643aef5b5d67a8937c790691` |
| Merge SHA | `476c0ce5adf33302b65bb77391835813017a62fc`; resulting tree `49919d853814a863194a6918058349e0931fdd34`; merged `2026-08-23T09:22:17Z` |
| Hosted CI / CodeQL / Security | PR CI `32629355521` was green on the final PR head; fresh main CI `32630810142` was fully green, including `✅ CI Success`; CodeQL `32630810130` was successful |
| Affected issues | None claimed closed or remediated by H0 |
| Release impact | None; no tag, release, updater metadata, or published asset changed |

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

## Next exact resume procedure

1. From a fresh branch based on verified `391dc506…`, classify the H1-A sample's failed,
   cancelled, and missing-job causes using authoritative job logs and artifacts.
2. Compare Node-22/24 overlap and Storybook/Deep E2E/VRT/Lighthouse signal; do not infer a lane
   decision from timing alone.
3. Keep H1-F0 inventory current and defer H1-F1 canonicalization until H1-A through H1-E decisions
   are measured and verified; carry the H1-F DevOps operating-model augmentation as binding.

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
| Hosted CI / PR / signing | PR #469 final head was GitHub Verified and all five material review threads were resolved; PR CI `32629355521` passed; fresh main CI `32630810142` and CodeQL `32630810130` passed; normal protected squash merge produced GitHub Verified commit `476c0ce5…` |
| H1-A measurement report | 50 CI/CD runs selected in the declared inclusive UTC window; aggregate metrics and raw run IDs recorded in `H1-CI-MEASUREMENT-REPORT.md`; no lane/DAG policy change |

## Program stop/go constraints

H0 is complete. H1-A measurement is captured but its lane decision remains pending: the sample shows
substantial Node-22/24 overlap and no lane-exclusive failure, but unique defect signal and failure
causes are not yet classified. Residual risks carried forward are the unavailable independent
updater verifier, fail-closed bundle-budget work deferred to H2-C, Intel qualification, and the later
R-15/native, plugin, collaboration, Scenario, and Qt evidence gates.
The restricted Codex sandbox incident remains an execution-environment limitation, not repository
corruption; the authorized writable context completed the signed branch/commit/push and GitHub
verification sequence. Stop and re-plan if a later stage discovers a release-boundary mutation,
weakened branch protection or signing, a suppression count that cannot be explained by tracked-source
state, or a mismatch between remote `main` and this ledger. H1–H8 remain dependency-ordered.
