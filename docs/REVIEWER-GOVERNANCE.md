# Reviewer governance

This document is the canonical repository policy for automated review and code-intelligence
providers. It defines durable roles and handling semantics; it does not attempt to mirror every
provider's UI, model, quota, billing state, or current availability.

## Authority hierarchy

The sources of truth are ordered as follows:

1. Executable repository policy, CI workflows, hooks, and scripts.
2. `AGENTS.md` for general agent and contributor rules.
3. This document for reviewer semantics, role boundaries, and evidence classification.
4. Vendor-specific repository adapters such as `.coderabbit.yaml` and `.deepsource.toml`.
5. Vendor dashboard settings.
6. Historical audits, handoffs, and dated incident records.

The machine-readable durable role registry is [`config/reviewer-registry.json`](../config/reviewer-registry.json).
Vendor adapters are narrow implementations of this policy, not competing policy documents.

The CI reviewer-governance gate has two layers. The ordinary `pull_request` workflow materializes
the complete base workspace (including workspace packages and pinned patches), then executes the
base-ref copies of `workflow-policy-check.mjs` and `check-reviewer-config.mjs` against the PR tree
as data. It has a one-time head-copy fallback only while the checker is first introduced. In
addition, `.github/workflows/reviewer-governance-trust.yml` is a base-owned
`pull_request_target` guard: it executes only trusted base code, fetches the PR head as an archive,
and validates that archive without running PR scripts or dependencies. This second layer prevents
a later PR from deleting or neutralizing the invocation step in the ordinary PR workflow. The
initial introduction is necessarily bootstrap-validated because the base ref predates both the
checker and the base-owned target workflow. Pushes and manual runs execute the checked-out copy.

## Provider roles and configuration ownership

| Provider | Durable role | Repository surface | Current state source |
| --- | --- | --- | --- |
| CodeRabbit | broad semantic correctness and repository-policy review | `.coderabbit.yaml` | live checks, review bodies, threads, and comments |
| Cubic | cross-file semantic and migration/persistence review | dashboard or vendor-exported `cubic.yaml` only after live schema/export verification | live checks, reviews, and dashboard |
| CodeAnt AI | secondary semantic/security corroboration and status gates | dashboard or vendor-confirmed `.codeant/**` only | live status checks, reviews, and threads |
| CodeScene | maintainability/code-health regression signal | dashboard or validator-confirmed `.codescene/**` only | live checks and review comments |
| DeepSource | independent analysis-only static signal | `.deepsource.toml` | live analyzer checks and dashboard |
| Sourcery | independent semantic review | dashboard only; no invented repository config | live reviews and dashboard |
| Graphite | additional semantic review signal | dashboard/workspace only unless official repo config is verified | live reviews and checks |
| chatgpt-codex-connector | optional semantic review channel | service configuration only | live connector output and quota state |
| Qodo | optional semantic review channel | no config until activation is proven | live provider state |
| Codecov | patch/full coverage evidence | `codecov.yml` plus CI artifacts | current check and CI-generated reports |
| CodeQL | security-static-analysis | `.github/workflows/codeql.yml` | current checks and artifacts |
| Semgrep | advisory external security-static-analysis signal | live Semgrep service; no repository config claimed | current checks and provider state |
| GitGuardian | secret-detection | `.gitguardian.yaml` | current checks and artifacts |
| Socket | supply-chain-security | dashboard/live service | current checks and provider state |
| OSV | enforced supply-chain-security gate | `src-tauri/osv-scanner.toml` plus CI invocation | current CI check and artifacts |

Provider silence is never equivalent to a clean review. Quota exhaustion, rate limiting, billing
blocks, provider suspension, skipped execution, and transient failure are separate live states.
The registry intentionally stores none of them.

## Finding taxonomy

Every observation is classified before action:

`CURRENT_REAL` · `DUPLICATE` · `OUTDATED` · `FALSE_POSITIVE` · `ADVISORY_ONLY` ·
`PROVIDER_QUOTA` · `PROVIDER_RATE_LIMIT` · `PROVIDER_BILLING_BLOCKED` ·
`PROVIDER_UNAVAILABLE` · `TRANSIENT`

The current exact head, source, tests, executable policy, and dependency/library version must be
checked before accepting a finding. A stale line anchor is not evidence that the current source is
wrong. A provider failure is not a clean review.

## Review loop

Collect one review wave across all three channels before mutating source:

- paginated inline review threads, including resolution state and replies;
- paginated top-level issue comments;
- paginated full review bodies, including nitpick and outside-diff sections.

Cluster findings by root cause and execution boundary. Implement one coherent corrective batch,
run the narrowest meaningful tests, and cite the resolving commit in each reply. Resolve inline
threads only after the reply; top-level comments and review bodies are dispositioned rather than
"resolved" because GitHub exposes no equivalent resolution mutation for them. Leave zero
actionable unresolved threads.

The read-only maintainer command is:

```bash
pnpm run reviewers:status -- --pr <number>
```

It requires an authenticated `gh` in a context with GitHub API access, fails closed on partial
fetches, prints provider/status evidence, and never comments, resolves threads, reruns jobs,
mutates branches, or prints credential values. If the sandbox cannot access the host keyring or
GitHub API, classify the result as `UNKNOWN` and use an authorized host context; do not replace
credentials based on a sandbox-only failure.

## Review independence and mutation boundary

AI reviewers may detect, explain, suggest, and verify. The signed maintainer/agent workflow
implements, tests, commits, pushes, and merges. No configured reviewer may auto-commit, auto-merge,
rewrite branch history, or bypass branch protection. CodeRabbit's `request_changes_workflow` is
explicitly disabled, and its branch-mutating finishing touches are disabled in `.coderabbit.yaml`.

Mechanical style, type, i18n, workflow, and security gates remain authoritative in CI. Reviewers
should concentrate on correctness, data loss, security, races, error handling, architecture,
behavioral tests, compatibility, and cross-file impact instead of duplicating formatter output.

## QNBS-v3 test semantics

QNBS-v3 records genuinely non-obvious rationale; it is not a decoration requirement. A test being
new, substantive, regression-critical, security-sensitive, or persistence-sensitive does not by
itself create a comment obligation. For tests and fixtures, a marker is appropriate only when a
non-obvious harness, setup, fixture, order, timing, mock, suppression, or compatibility choice
needs explanation beyond the test name, inputs, and assertions.

Straightforward regression cases whose names, fixtures, and assertions state the invariant need no
QNBS-v3 marker. `scripts/check-qnbs-v3-comments.mjs` checks the physical-line form of markers that
exist; it does not require blanket marker presence. Before reporting a policy violation, quote the
current rule and verify its exceptions in the same rule.

## Path-specific priorities

The CodeRabbit adapter supplies narrow guidance for the following boundaries:

- `tests/**`: meaningful behavior, race edges, and assertion quality; no generic docstring or
  QNBS demand for obvious regression cases.
- `services/storage/**`, project services, and `features/project/**`: preserve-first refusal,
  raw numeric fidelity, schema authority, migration, generation fences, readable-versus-writable
  capabilities, and no fallback dual-write after canonical refusal.
- `.github/**`, `scripts/**`, and `config/**`: fail-closed governance, signed commits, least
  privilege, pinned tools, deterministic read-only diagnostics, and no live state in durable files.
- security and native paths: real threat model, CSP/encryption/storage boundaries, approved
  desktop capability routing, and no weaker fallback.
- `docs/audit/**` and `docs/history/**`: distinguish current policy from dated evidence; do not
  rewrite historical truth merely because the present state changed.

## Coverage and graph intelligence

Codecov is coverage evidence, not semantic review. A patch failure is investigated by reading the
CI-generated lcov/report artifact, mapping changed lines, checking source semantics, using
CodeGraph for affected callers/tests where useful, and adding only meaningful focused tests. Full
coverage remains cloud-owned on this hardware; no suppression or assertion-only test is added for a
percentage.

CodeGraph is local, incremental impact/test-selection intelligence. Graphify is local architectural
and cross-module intelligence. Only compact reports are eligible for version control; databases,
HTML, JSON caches, transcripts, query logs, telemetry settings, and MCP/user configuration remain
local and regenerable. Reviewer governance does not trigger graph rebuilds or report churn.

## Dashboard-only and vendor validation status

The current repository has durable adapters only where their syntax and safety behavior are
verified: CodeRabbit and the existing DeepSource/Codecov surfaces. Cubic, CodeAnt, CodeScene,
Sourcery, Graphite, and Qodo require live dashboard/export/schema evidence before adding or
changing a repository file. Their intended role is recorded in the registry, while availability
and settings remain `DASHBOARD_CONFIGURED / VERIFY_LIVE` or `PROVIDER_UNAVAILABLE` as appropriate
in operational notes, never as permanent quota facts.

No provider config is a suppression file. A real maintainability, security, persistence, or
correctness finding must be fixed or evidence-dispositioned; lowering thresholds or excluding a
path merely because a bot found a real defect is not acceptable.

## Validation and canary policy

The offline checker is intentionally small and network-free:

```bash
pnpm run reviewers:check
```

It validates JSON/YAML syntax, configured paths, registry relationships, CodeRabbit's
no-mutation invariants, and the absence of durable quota/billing/current-status fields. It does not
pretend to replace vendor schema validators. CI runs the same checker once in the lightweight
workflow-policy job, and `ci:prepush` routes it through the local admission registry whenever the
reviewer policy/configuration changes.

Any future vendor adapter should first be validated against the vendor's current official schema or
export. If behavior is uncertain after configuration lands, use one bounded draft canary: an
obvious test without a QNBS marker should not produce a missing-marker finding; a genuinely
non-obvious persistence fallback should still be flagged; generated-only output should not create
semantic noise; and a real complexity regression should remain visible. Never merge a canary defect
or repeatedly retrigger a quota-limited provider.
