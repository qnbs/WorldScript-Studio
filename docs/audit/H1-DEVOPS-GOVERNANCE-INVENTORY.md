# H1-F0 DevOps and governance inventory

Status: evidence inventory in progress; H1-A failure/signal evidence is now recorded; no H1-B/C/D/E
decision is claimed here.

Captured from a verified `main` checkpoint on 2026-08-23, branch
`h1-a-f0-evidence`, based on `c91e37691409aa4b5febbf527219c891256b6487`.
This document is an evidence artifact, not the final H1 operating model. Live GitHub state must
be re-queried before execution decisions.

## Authority and state semantics

The current working hierarchy is:

| Level | Authority | Inventory interpretation |
| --- | --- | --- |
| 0 | Workflows, scripts, hooks, test/build configuration, and GitHub-enforced settings | Behavioral truth; verify before changing prose |
| 1 | Future canonical H1 DevOps operating model | Not yet materialized; H1-F1 depends on H1-A through H1-E decisions |
| 2 | Agent and contributor entrypoints | Useful constraints, but currently contain duplicated and time-sensitive policy |
| 3 | Audits, handoffs, and history | Evidence or historical context; not current authority unless explicitly linked |

The durable program ledger currently contains a *last reconciled main checkpoint*, not a live-main
claim. A stored SHA in a repository-tracked file cannot remain literally current after the commit
that changes that file is merged. This is recorded below as the H1-F governance finding rather than
as an H0 failure. Live `main`, protection, open work, and check state are obtained from Git and the
GitHub API at resume time.

## Live checkpoint evidence

These values are immutable evidence for this inventory slice and are not a substitute for a fresh
query in a later session:

| Observation | Value | Classification |
| --- | --- | --- |
| Verified main commit | `c91e37691409aa4b5febbf527219c891256b6487` | CURRENT at capture time; re-query later |
| Main tree | `dc6d83f91fb890d8ffd5bb22266f8e557bfa952b` | CURRENT at capture time; re-query later |
| Main commit verification | `verified=true`, `reason=valid` | IMMUTABLE EVIDENCE for this checkpoint |
| Post-#470 main CI | Run `32633166716`, successful on the main SHA; `✅ CI Success` passed | IMMUTABLE EVIDENCE |
| Post-#470 CodeQL | Run `32633166783`, successful on the main SHA | IMMUTABLE EVIDENCE |
| Open PRs | 0 at capture time | CURRENT at capture time; re-query later |
| Open issues | 16 at capture time | CURRENT at capture time; re-query later |
| Required signatures | Enabled | CURRENT GitHub policy; re-query later |
| Required status | `✅ CI Success` (the protection API exposes the same context in both legacy/context and check fields) | CURRENT GitHub policy; re-query later |
| Conversation resolution | Enabled | CURRENT GitHub policy; re-query later |
| Force pushes/deletions | Disabled | CURRENT GitHub policy; re-query later |

## Executable surface inventory

| Surface | Observed truth | Classification | Follow-up |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | Push, pull-request, and dispatch workflow with Security, path classification, Verified Signatures, Node 22/24 Quality matrix, path-scoped Rust gates, Build, browser/release evidence jobs, and fail-closed `✅ CI Success` aggregation | CURRENT; MACHINE-DERIVABLE | H1-A measures before H1-B changes the DAG or lane authority |
| `.github/workflows/codeql.yml` | Push, pull-request, and weekly scheduled JavaScript/TypeScript CodeQL analysis; job-scoped `security-events: write` | CURRENT; MACHINE-DERIVABLE | Preserve as independent security evidence |
| `.github/workflows/tauri-build.yml` | Workflow dispatch and `v*` tag triggers; Linux, Windows, and `macos-latest` bundle matrix; release publication and updater metadata | CURRENT; MACHINE-DERIVABLE | H1-D/E qualify future Intel/verifier claims; do not mutate v1.28.1 |
| `.github/workflows/mutation.yml` | Manual `workflow_dispatch`; incremental/force modes and scoped matrix | CURRENT; MACHINE-DERIVABLE | H2 owns mutation evidence |
| Scheduled/support workflows | `security-scheduled.yml`, `scorecard.yml`, `voice-nightly.yml`, `prune-deployments.yml`, `docker.yml`, and debug/deploy surfaces also exist | CURRENT; TIME-SENSITIVE | Include trigger/permission review in H1-F1 |
| `.github/actions/setup/action.yml` | Shared Node/pnpm/install setup action | CURRENT; MACHINE-DERIVABLE | Treat as Level 0 toolchain authority |
| `package.json` | pnpm `11.22.0`, Node `>=22`, local `ci:prepush`, `typecheck:single`, i18n/docs/CSP/native guards, build and CI-only heavy commands | CURRENT; MACHINE-DERIVABLE | Derive commands rather than duplicating them in agent files |
| Hooks and signing | `simple-git-hooks`, `scripts/hooks/pre-commit.mjs`, `scripts/hooks/pre-push.mjs`, `pnpm run signing:doctor`; SSH signing enabled | CURRENT; MACHINE-DERIVABLE | Preserve signed-source and GitHub verification distinction |
| Test/build config | `vitest.config.ts` imports `scripts/coverage-thresholds.json`: lines 80, functions 72, branches 66, statements 78 | CURRENT executable truth | Reconcile stale prose in H1-F2/F4; do not lower thresholds |
| Desktop/native config | `src-tauri/`, `crates/`, `src-tauri/tauri.conf.json`, native roadmap/ADRs | CURRENT architecture plus future gates | Do not make H1 a product/native implementation stage |

## Instruction and contributor surfaces

| Surface | Inventory result | Classification | H1 action |
| --- | --- | --- | --- |
| `AGENTS.md` | Detailed local-resource, signing, review, merge, and CI instructions; also contains a rigid PR-size heuristic | CURRENT constraints plus DUPLICATED/TIME-SENSITIVE policy | Thin synchronization in H1-F2; remove universal file-count framing |
| `CLAUDE.md` | Detailed CI/reviewer/merge-quirk manual; prior admin-squash wording was corrected in this slice; rigid ~100-file rule remains | DUPLICATED/TIME-SENSITIVE policy with a remaining P1 framing issue | Preserve the safety correction; broader consolidation in H1-F2 |
| `.github/copilot-instructions.md` | Agent guidance and targeted coverage-debug examples | CURRENT plus DUPLICATED policy | Reconcile with canonical docs in H1-F2 |
| `.cursorrules`, `.cursor/rules/**` | Cursor-wide and topic-specific architecture/testing instructions | CURRENT architecture plus DUPLICATED policy | Inventory retained; thin entrypoint work in H1-F2 |
| `.github/CONTRIBUTING.md` | Contributor workflow entrypoint | CURRENT contributor surface; completeness to verify | Align after canonical H1-F1 model exists |
| `docs/CI.md`, `docs/CODE_QUALITY.md`, `docs/BEST-PRACTICES.md` | Current-facing CI, quality, and metrics prose with some duplicated thresholds/metrics | CURRENT plus P2 documentation drift candidates | Correct against executable config after H1-A/B evidence |
| `docs/TAURI-CI.md` and release/security docs | Desktop/release trust and native guidance | CURRENT plus H1-D/E pending claims | Keep Intel/updater status explicitly pending until qualified |
| `docs/CODEANT-REVIEW-LOOP.md` and `docs/DEEPSOURCE-REVIEW-LOOP.md` | Review procedures; historical admin fallback language found | P1 process drift where presented as current policy | Corrected in this slice; external availability remains time-sensitive |
| `.github/CI-AUDIT.md`, `.github/ACTIONS-OPTIMIZATIONS.md` | Audit/optimization snapshots | HISTORICAL or audit evidence unless explicitly current | Label/link from canonical docs; do not rewrite history |
| `docs/audit/**`, `docs/history/**`, session handoffs | Mixed stage evidence, historical plans, and handoffs | HISTORICAL, IMMUTABLE EVIDENCE, or NOT-AUTHORITATIVE by file | Classify per file before any later truth sweep |
| `README.md` | Documentation and metrics hub | CURRENT entrypoint with duplicated volatile facts | Update only after H1-F1 canonical hub exists |

## H1-F governance findings

| Finding | Severity | Evidence | Classification | Disposition |
| --- | --- | --- | --- | --- |
| Self-referential durable-ledger freshness problem | P1 | The H0 ledger’s stored main field was `476c0ce5…`; merging that ledger PR advanced live main to `c91e3769…` | CONTRADICTORY data model, not repository corruption or H0 failure | This inventory records the finding. The ledger now uses checkpoint semantics; H1-F1 should define the durable model and optional live-status command. No recursive ledger-only PR is authorized. |
| Standing admin-merge fallback language | P1 | `CLAUDE.md`, `docs/CODEANT-REVIEW-LOOP.md`, `docs/DEEPSOURCE-REVIEW-LOOP.md`, and i18n/runbook text contained admin-squash procedures | CONTRADICTORY current policy; some audit/tombstone material is HISTORICAL | Corrected current-facing instructions in this slice. Historical records remain evidence and are not rewritten as current. |
| Duplicated CI DAG descriptions | P1 | `CLAUDE.md`, `AGENTS.md`, `docs/CI.md`, audit snapshots, and workflow files describe overlapping graphs | DUPLICATED; MACHINE-DERIVABLE truth exists in workflows | H1-A inventory first; H1-F1 canonical CI authority and later semantic policy tests |
| Duplicated Node-version assumptions | P2 | Workflow matrix is Node 22/24; prose repeats versions and hypothesizes future lanes | DUPLICATED; TIME-SENSITIVE | No lane change in this slice; H1-A measures authority/compatibility decision |
| Duplicated coverage thresholds and metrics | P2 | Executable thresholds are 80/72/66/78; older prose includes 74/60/67/72 and historical measured values | CURRENT, HISTORICAL, or STALE depending on file | H1-F2/F4 reconcile only after tracing each statement; no threshold change |
| Hard ~100-file PR rule | P1 | Agent and review docs state an under-100 universal limit even though it is an external reviewer constraint | CONTRADICTORY policy framing | H1-F2 correction: smallest coherent reviewable scope; retain tool limitation as time-sensitive external fact |
| Intel macOS runner assumptions | P2 | Tauri workflow currently publishes only `macos-latest`; comments record removed Intel hosting and no qualification path | CURRENT pending state; MACHINE-DERIVABLE | H1-D owns non-publishing qualification; no production support claim |
| Reviewer role/availability assumptions | P2 | Live #470 showed CodeRabbit/Amazon Q/CodeAnt evidence, Qodo billing-blocked, Sourcery rate-limited | EXTERNAL and TIME-SENSITIVE | Canonical registry must distinguish silence, quota, billing, pending, and substantive review |
| Required/advisory duplication | P1 | Branch protection requires `✅ CI Success`; docs and workflow separately describe advisory jobs and aggregator semantics | DUPLICATED, MACHINE-DERIVABLE | H1-B decides final semantics; H1-F1 documents layers separately |
| Signing terminology ambiguity | P1 | Source signatures, GitHub squash verification, tag signing, updater signatures, Apple signing, and notarization appear in separate surfaces | DUPLICATED/NOT-AUTHORITATIVE when collapsed | Canonical release/trust model in H1-F1 after H1-E evidence |
| Merge-state quirks mixed with policy | P1 | #469 and older audit records show `BLOCKED` presentation despite normal server merge; older docs describe admin fallback | HISTORICAL evidence mixed with current policy | Preserve #469 as an observed instance; never make REST or admin a universal rule |
| Current versus historical CI audits | P2/P3 | `.github/CI-AUDIT.md`, `.github/ACTIONS-OPTIMIZATIONS.md`, and dated handoffs contain snapshots | HISTORICAL/AUDIT | Label and link; preserve accurate historical evidence |
| Git/GitHub sandbox assumptions | P1 | H0 restricted sandbox had read-only `.git`/blocked API; authorized context passed probes and signed push | EXTERNAL execution-environment incident | Canonical preflight must detect and classify this before long PR-producing work |

## H1-F0 boundaries and next work

This inventory does not decide the Node canonical lane, required/advisory promotion, build
authority, Intel production support, or independent updater verification. Those decisions require
H1-A through H1-E evidence. It does not authorize H2/H3/H4/H7 implementation, release work,
product changes, Qt/GPUI work, licensing, or #332/#341 remediation.

The current evidence record and next tasks are:

1. The reconciled 50-run sample is recorded in
   [`H1-CI-MEASUREMENT-REPORT.md`](H1-CI-MEASUREMENT-REPORT.md).
2. Failure/cancellation evidence is recorded in
   [`H1-CI-FAILURE-SIGNAL-REPORT.md`](H1-CI-FAILURE-SIGNAL-REPORT.md): all investigated runs are
   first attempts, cancellations are concurrency-supersession evidence, and advisory unique
   signal remains `UNKNOWN`.
3. Continue classifying timing, cache, rerun, overlap, and unique-signal evidence without
   cherry-picking only green runs; use a future meaningful H1 PR to reconcile the checkpoint and
   inventory as needed, never a
   recursive ledger-only PR;
4. defer H1-F1 canonical docs and H1-F2 agent synchronization until the relevant H1 decisions are
   verified, except for the early admin-bypass safety correction already made here.

## Resume invariant

Read this inventory and the durable ledger, then query live GitHub/origin state. A stored checkpoint
is evidence of the last reconciliation, not a claim about today’s `main`.
