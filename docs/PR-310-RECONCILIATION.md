# PR #310 reconciliation ledger

Status: in progress. This document is the authoritative disposition record for
[`#310`](https://github.com/qnbs/WorldScript-Studio/pull/310); it does not make
the pull request merge-ready by itself.

## Live baseline

| Field | Value |
| --- | --- |
| Main SHA | `804793aa0815a726935785639e4fb139af7c4b59` |
| PR #310 base / head | `804793aa0815a726935785639e4fb139af7c4b59` / `27177ce549d4579f1fc9dfbc4630ebf0c2592f9b` |
| PR #310 commits / changed files | 9 / 35 |
| Merge state | `MERGEABLE`, but `BLOCKED` |
| Open review threads | 28 of 317 historical threads |
| Failing check | `DeepSource: JavaScript` (parsing `scripts/resolve-deepsource-threads.mjs`) |

## Strategy

**Option C — supersede #310 through traceable replacement work.** PR #335 is
the fail-closed lifecycle foundation and PR #337 is the recovery/secondary-store
implementation track. #310 must remain open until every row below is implemented,
tested, and mapped to a replacement commit. It must not later be merged on top of
the replacements because that would duplicate migrations and lifecycle controls.

## Commit reconciliation

| ID | PR #310 commit | Intent | Disposition | Final location / verification |
| --- | --- | --- | --- | --- |
| PR310-R001 | `13b956e` | Encrypt inference, ProForge, and scene-revision content | ADOPTED_WITH_MODIFICATIONS | #337 protected-store adapters, with journal checkpoints and record-shape decoders |
| PR310-R002 | `a70bba8` | Encrypt cross-project and LoRA metadata | ADOPTED_WITH_MODIFICATIONS | #337 protected-store adapters, with conditional lazy migration and multi-writer protection |
| PR310-R003 | `6b96baa` | Describe boundary and lifecycle | SUPERSEDED_BY_BETTER_IMPLEMENTATION | Final documents are updated only after recovery behavior is executable and tested |
| PR310-R004 | `0898f6a` | Reject incomplete secure envelopes | ADOPTED_WITH_MODIFICATIONS | #337 secure-envelope parser; malformed candidate data must fail closed |
| PR310-R005 | `7139d4c` | Repair IDB test mock wiring | ADOPTED_WITH_MODIFICATIONS | Retain only if the final adapter tests import the same constants; prove with focused tests |
| PR310-R006 | `c991c03` | Add AAD, Blob codec, delete gating, and lifecycle calls | ADOPTED_WITH_MODIFICATIONS | AAD/Blob/delete protections move into the shared policy; unsafe lifecycle calls are superseded |
| PR310-R007 | `3a18c9d` | Reduce codec complexity for DeepSource | NO_LONGER_APPLICABLE | The final codec is structured for correctness; analyzer thresholds will not be raised to hide risk |
| PR310-R008 | `5f3ad25` | Consolidate secondary-store migration | SUPERSEDED_BY_BETTER_IMPLEMENTATION | Replace aggregate helpers with registered adapters driven by durable journal checkpoints |
| PR310-R009 | `27177ce` | Cover migration and missing-store paths | REWRITE | Preserve missing-store coverage and add interruption, legacy-shape, resume, and verification cases |

## Behavior reconciliation

| ID | Behavior | Security/data impact | Disposition | Final implementation / proof |
| --- | --- | --- | --- | --- |
| PR310-B001 | Versioned AES-GCM envelopes for secondary payloads | Confidentiality and integrity | ADOPTED_WITH_MODIFICATIONS | v2 shared envelope API with strict candidate validation; the legacy v1 reader migrates only authenticated, AAD-bound namespaces |
| PR310-B002 | AAD binds store and record id | Detects record swapping | ADOPTED_WITH_MODIFICATIONS | Database/store/record AAD is mandatory for v2; AAD-less ciphertext is recovery-required rather than silently accepted or rewritten |
| PR310-B003 | Blob-preserving structured codec | Prevents ProForge artifact corruption | ADOPTED_WITH_MODIFICATIONS | Preserve Blob/`Uint8Array`/`undefined`; reject non-finite and non-plain structured-clone values rather than flattening them |
| PR310-B004 | Locked secondary reads/writes/deletes fail closed | Prevents plaintext downgrade and destructive mutation while locked | ADOPTED_WITH_MODIFICATIONS | One lifecycle-policy guard for every protected adapter and background writer |
| PR310-B005 | Lazy legacy migration after unlock | Migrates existing plaintext without silent loss | ADOPTED_WITH_MODIFICATIONS | Adapter-specific canonical decoders plus conditional, non-stale rewrites |
| PR310-B006 | Bulk disable conversion | Recoverability | SUPERSEDED_BY_BETTER_IMPLEMENTATION | Journalled, checkpointed decrypt-to-plaintext before verifier retirement |
| PR310-B007 | Bulk passphrase rotation | Recoverability | SUPERSEDED_BY_BETTER_IMPLEMENTATION | Journalled per-store/key-generation rekey; old verifier capability retained until verification |
| PR310-B008 | Direct cross-database aggregate calls | Crash safety | REJECTED_WITH_TECHNICAL_RATIONALE | IndexedDB cannot make these atomic; a saga/journal is mandatory |
| PR310-B009 | DuckDB metadata / large LoRA blob exceptions | Threat-model scope | ADOPTED_WITH_MODIFICATIONS | Retain only precise, tested exceptions; do not claim blanket encryption |
| PR310-B010 | DeepSource configuration threshold increase | Review signal quality | REJECTED_WITH_TECHNICAL_RATIONALE | Do not relax complexity policy to silence the failing JavaScript analyzer |

## Review-thread reconciliation queue

Every listed thread remains open until its engineering concern is implemented,
tested, replied to, and resolved. `OUTDATED` only means the anchor moved; it is
not a disposition.

| Thread(s) | Concern | Planned disposition |
| --- | --- | --- |
| `PRRT_kwDOQOeAgc6VqDnU`, `PRRT_kwDOQOeAgc6VqF6o`, `PRRT_kwDOQOeAgc6WAh92`, `PRRT_kwDOQOeAgc6WBA9X`, `PRRT_kwDOQOeAgc6WBA-e` | Disable/rekey can strand ciphertext or create mixed generations | SUPERSEDED_BY_BETTER_IMPLEMENTATION: durable journal and blocked lifecycle API until recovery is complete |
| `PRRT_kwDOQOeAgc6VqDna`, `PRRT_kwDOQOeAgc6VqF6m` | Partial envelopes are accepted as legacy plaintext | ADOPTED_WITH_MODIFICATIONS: strict candidate classifier and corruption tests |
| `PRRT_kwDOQOeAgc6VqF6l` | Deletes bypass locked-state protection | ADOPTED_WITH_MODIFICATIONS: central protected-write policy covers delete operations |
| `PRRT_kwDOQOeAgc6VqF6q` | Swapped valid envelopes are not detected | ADOPTED_WITH_MODIFICATIONS: stable AAD context and swap tests |
| `PRRT_kwDOQOeAgc6VqF6r` | Blob artifacts are serialized as empty objects | ADOPTED_WITH_MODIFICATIONS: binary-safe codec and Blob round-trip tests |
| `PRRT_kwDOQOeAgc6WAXf2` | In-memory inference cache bypasses lock | ADOPTED_WITH_MODIFICATIONS: lock check precedes memory-cache reads and eviction tests |
| `PRRT_kwDOQOeAgc6WAghi`, `PRRT_kwDOQOeAgc6WAghn` | LoRA lazy migration/activation can overwrite concurrent updates | ADOPTED_WITH_MODIFICATIONS: conditional rewrite/transaction ownership checks |
| `PRRT_kwDOQOeAgc6WAh80`, `PRRT_kwDOQOeAgc6WAh87` | Encryption default and recovery documentation are inaccurate | SUPERSEDED_BY_BETTER_IMPLEMENTATION: final docs follow executable policy and recovery UX |
| `PRRT_kwDOQOeAgc6WAh9E` | Cross-project decoded payload/schema is not validated | ADOPTED_WITH_MODIFICATIONS: adapter decoder validates schema before use or rewrite |
| `PRRT_kwDOQOeAgc6WAh9O` | Failed best-effort rewrite hides valid LoRA reads | ADOPTED_WITH_MODIFICATIONS: return decoded data while reporting a safe migration-write failure |
| `PRRT_kwDOQOeAgc6WAh9q` | Scene revision eviction decrypts all content | ADOPTED_WITH_MODIFICATIONS: use plaintext routing metadata for eviction |
| `PRRT_kwDOQOeAgc6WAsgW`, `PRRT_kwDOQOeAgc6WA2oe`, `PRRT_kwDOQOeAgc6WBH2E`, `PRRT_kwDOQOeAgc6WBsgD` | Rotation/disable lose legacy flat record shapes | SUPERSEDED_BY_BETTER_IMPLEMENTATION: canonical per-store decoders are part of journal adapters |
| `PRRT_kwDOQOeAgc6WBA9v` | Required one-line rationale missing | NO_LONGER_APPLICABLE: unsafe call is removed; new non-trivial lifecycle calls include a one-line rationale |
| `PRRT_kwDOQOeAgc6WBA90`, `PRRT_kwDOQOeAgc6WBA95`, `PRRT_kwDOQOeAgc6WBA-a` | Missing stores, malformed cache data, and history migration behavior | REWRITE: final registered adapters use safe open/close, shape validation, and single-transaction writes |
| `PRRT_kwDOQOeAgc6WBA-i` | Codec stringifies unsupported values / corrupts non-finite numbers | ADOPTED_WITH_MODIFICATIONS: explicit undefined node and strict unsupported-value rejection |
| `PRRT_kwDOQOeAgc6WBmtc` | DeepSource parses an ESM maintainer script as CommonJS | SUPERSEDED_BY_BETTER_IMPLEMENTATION: remove the ad-hoc resolver script and fix analyzer-compatible code/config without a threshold waiver |

## Test reconciliation

| Original area | Disposition | Replacement evidence required |
| --- | --- | --- |
| Secure envelope and corruption tests | UPDATE | Candidate, version, IV/ciphertext, AAD swap, codec-value, and wrong-key cases |
| Per-store encrypted round trips | RETAIN | One registered adapter fixture per protected store, including binary artifacts |
| Legacy lazy-migration tests | REWRITE | Flat legacy shape plus conditional write race and failure-safe read result |
| Secondary lifecycle happy paths | REPLACE | Journal creation, every checkpoint boundary, interruption/restart, verify, commit, cleanup |
| Optional/missing store test | RETAIN | Missing stores are no-ops that are checkpointed and verified rather than silently skipped |
| Cross-project mock repair | UPDATE | Keep the full constants mock only if final test imports require it |

## Supply-chain evidence

### SUPPLYCHAIN-PNPM-001 — pnpm v11 build-script policy drift

| Field | Evidence |
| --- | --- |
| Original config | Legacy `onlyBuiltDependencies` / `ignoredBuiltDependencies` lists plus contradictory `allowBuilds: true` entries |
| Final config | One pnpm v11 `allowBuilds` map: only required native packages (`@swc/core`, `esbuild`) are `true`; every other known build-script package is explicitly `false` |
| Active toolchain | Node `v24.11.1`, pnpm `11.5.2`, declared `pnpm@11.5.2` |
| Reason | pnpm v11 documents `allowBuilds` as the replacement control; legacy lists no longer define the effective policy |
| Scripts newly allowed | None; the policy was narrowed after manifest-level evidence showed only the two native packages require an install hook |
| Scripts newly denied | `@google/genai`, `core-js`, `onnxruntime-node`, `protobufjs`, `sharp`, `simple-git-hooks`, `unrs-resolver`, and `workerd` dependency lifecycle scripts |
| Additional guard | `pnpm-workspace.yaml` is the sole effective pnpm-v11 policy: `verifyDepsBeforeRun: error`, `minimumReleaseAge: 10080`, strict build/integrity controls, and the narrow `allowBuilds` map; root Git-hook setup moved from automatic `prepare` to explicit `hooks:install` |
| Verification | Script-free `pnpm install --lockfile-only --ignore-scripts` exit 0; active pnpm `config get` confirms `verifyDepsBeforeRun=error`, `minimumReleaseAge=10080`, `strictDepBuilds=true`, `blockExoticSubdeps=true`, and `verifyStoreIntegrity=true`; direct Biome, docs, and suppression checks passed |
| Rollback | Revert the policy commit; do not use `approve-builds`, a broad allowlist, or an automatic root `prepare` |

### SUPPLYCHAIN-PNPM-002 — release-age lockfile reconciliation

| Field | Evidence |
| --- | --- |
| Trigger | Vercel deployment `dpl_Gyzd9qSWPHFq3En1roQ1BVTF72Gp` failed before build because `ip-address@10.5.0` was published on 2026-08-10, inside the active 10,080-minute release-age window |
| Dependency path | `@lhci/cli` → `proxy-agent` → `socks` → `ip-address`; `pnpm why ip-address --depth Infinity` found no other version or writer |
| Final override | The broad floor `ip-address: ">=10.3.1"` is replaced with exact `ip-address: "10.3.1"`, the first patched version and a release outside the seven-day quarantine |
| Integrity evidence | The public npm registry manifest for `ip-address@10.3.1` reports `sha512-1e9d3kb97NHJTIJDZW9rKqW2h6+dFa50Dy0fpPSMQp2ADje5gvKsXmdiK6dwY5t76TaTt5+P5N1Y/LoToIxP6g==`, no runtime dependencies, npm signatures, and SLSA provenance |
| Lockfile scope | Exactly the override, package integrity record, empty snapshot, and `socks` dependency reference changed; `git diff --check` passed |
| Policy source of truth | pnpm 11 normalizes `minimumReleaseAge` out of generated lockfile settings. The effective policy remains `pnpm-workspace.yaml`; `pnpm config get minimumReleaseAge` returns `10080`. The lockfile is not treated as the authority for this setting. |
| Controlled repair boundary | Recovery used only `--lockfile-only`, `--ignore-scripts`, low CPU/I/O priority, and pnpm's documented `--trust-lockfile` repair path. No lifecycle scripts, rebuilds, or broad build approvals were run. |
| Verification still required | A clean Vercel installation and its deployment build must pass on this commit. Full local resolution is deliberately not retried while this low-memory host has about 511 MiB available RAM and 1.8 GiB active swap. |
| Rollback | Revert the workspace override and matching lockfile records together. Do not reduce `minimumReleaseAge`, disable `verifyDepsBeforeRun`, or add a broad build-script allowlist. |

## Current merge decision

**NO-GO — REQUIRES FURTHER REMEDIATION.** PR #310 contains valuable secondary-store
work, but its own lifecycle path is non-resumable and its 28 open review threads
include data-loss and recovery blockers. It may become **SUPERSEDED — SAFE TO CLOSE
AFTER VERIFIED REPLACEMENT** only when every ledger row has a replacement commit,
passing invariant test, thread reply/resolution, and final documentation disposition.
