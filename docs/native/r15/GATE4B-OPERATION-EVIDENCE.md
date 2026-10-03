# Gate 4B — protected operation proof boundary

Predecessor: kernel admission foundation, PR #951; root mutex, PR #950. This slice is headless Core
operation integration for #360, not journal/rekey execution, migration inventory, deletion or a
production authority switch. Gate 4 remains partial. Terminal status requires final-head review/CI,
protected merge and exact resulting-main/Production verification; local tests alone do not supply it.

## Design and race matrix

One dedicated installation directory and its immediate-child authority root define admission scope.
Shared ordinary admission and exclusive transitions reuse the kernel foundation (Unix flock;
Windows LockFileEx, pinned no-delete-share handles with volume/file-ID comparison). The provider is
private to `ProtectedStorage`; normal semantic callers cannot select or retain keys outside admission.
Guards are Send, not Sync/Clone. A finite root event borrows its admission and cannot outlive it.

Ordinary mutation/reconciliation also holds one kernel-backed `ordinary-writers` child resource.
This intentionally conservative version-1 serialization closes same-record staging/recovery races
without unbounded lock inventories. Readers remain admitted and never take the root mutex.

```text
write: shared admission → writer resource → snapshot/key/reconciliation/CAS
       → finite PENDING root event → staging/promotion → finite ACTIVE root event → completion
read:  shared admission → atomic snapshot pin/key → authenticate root/retain exact epoch entries
       → authenticate pinned view → handoff → drop key/pin/epoch metadata → release admission
lock:  exclusive admission/drain → authenticate quiescence → clear keys → retain exclusion
unlock: retained/new exclusive → load keys/authenticate authority → release, or clear/retain on error
```

No upgrade, no admission acquisition while holding a root event, no root mutex during staging,
and no lock-body/PID/timeout authority. Each root event rereads/replans beneath its own root mutex;
CAS errors preserve data. Reconciliation can change a record generation, so generation expectation
is checked after reconciliation and before starting the new write.

The authority cell mutex covers capture plus Arc clone and step F plus current replacement. Read
keys and pins drop before shared admission. The handoff callback runs while all remain live. A
reader may keep an old immutable view across arbitrarily many later root commits. Shared admission
blocks cross-process exclusive reclamation, in addition to local pins and durable retention (§4.1 of
`AUTHORITY-SNAPSHOT-LIFETIME.md`). Weak retention observations cannot grant deletion authority.

Pinned reads reopen the exact immutable epoch-control generations authenticated at capture, not
later directory heads. Current cold start/root commits retain strict newest-set verification.
At step F an original provider failure is preserved as an uncertain root-commit outcome, never
permission to replay the logical mutation. Successful F with failed local refresh is specifically
`CommittedRefreshRequired`; recover/reload the committed intent, do not start a fresh write.

| Invariant / race | Code owner | Focused proof |
|---|---|---|
| Unified cross-process modes, crash release, pinned identity | `admission.rs`, existing platform foundation | `gate4b_admission_test`; child processes, exit/abort, identity replacement |
| Admission before provider/key observation; no obsolete-epoch late commit | `operations.rs`, private provider | staging/child probes return contention with zero observations; exclusive barriers |
| One shared write across both root events; staging outside root mutex | `protected.rs`, `WriterGuard` | two root generations; staging root availability; both pointer-before-F windows |
| Record CAS after pending recovery | protected write expectation | completed pending generation publishes, stale replacement is refused |
| Readers use pinned authenticated view, not pointer/current-file guesses | snapshot root/catalog helpers | prior payload remains readable at both pointer-before-F windows |
| Atomic capture/pin and F/current publication | `operation_authority.rs` | paused exact capture-to-pin seam holds the mutex while a writer attempts publication |
| Guard not Sync/Clone; Send; key/pin before admission release | opaque reader guard | compile-fail doctests; Send assertion; two readers across three writer operations |
| Current/previous/local pins/other recovery retention | retention witness, exclusive eligibility query | live pin blocks exclusive; old root eligible after release; current/previous and recovery reason refuse |
| No persisted pins; namespace cannot survive restart or cross coordinators | authority cell | restarted cell builds from anchor; foreign witness/guard refuse |
| Locked/migrating legacy plaintext cannot bypass admission/state | protected read entry | no callback, filesystem access or key resolution; plaintext fixture stays unchanged |
| Lock drains through handoff; failed unlock retains exclusion | lifecycle methods | callback cannot acknowledge lock/unlock/shutdown; child process excluded after failed unlock |
| Cancellation, root contention and shutdown preserve recovery state | RAII guards, reconciliation | staging unwind and ACTIVE-root contention preserve prior authority; shutdown refuses until recovery |
| Scope-bound record locations; ordinary-class boundary | location pins, class guard | foreign installation refused; asset member refused before any observation/coordination write |

The operation helpers are one proof unit: write key selection uses the same cell/pin machinery as
reads; lock/shutdown acknowledgements depend on both lifetimes ending; F publication must be atomic
with pin capture. Splitting those interfaces mid-integration would leave a semantic bypass rather
than an independently usable operation boundary. Keep the PR inside the absolute budget with
correction reserve; do not add unrelated work. Gate-3 raw-vector entrypoints are test-support only.

## Evidence classification and deferred owners

Focused local Rust tests, doctests, default build and warnings-denied Clippy are local evidence.
Linux Core CI plus macOS/Windows secure-store platform CI run the operation suite and library proofs.
Those jobs are `CI_ONLY`, not packaged/power-loss qualification. Platform secure-store lifecycle
continues to run separately; the child operation probes intentionally need no real credentials.

No journal, epoch rotation, full recovery executor, enable/disable state machine, plaintext migration,
asset-pair writer, transitive collector or production caller is introduced. Owners remain 4C journal,
4D rekey/#359 and key-epoch crash window, 4E first enable/disable refusal, Gate 5 exhaustive writers
and asset pairs, Gate 6 packaged/physical evidence, #948 deletion and explicitly authorized Gate 7.
The kernel barrier has no durable authority claim, so process death cannot falsely commit a transition
or prevent future recovery. No gate is terminal merely because this design/test document exists.

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.
