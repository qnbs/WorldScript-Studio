# S5-B2 — AuthoritySnapshot Lifetime & Reclamation

**Issue:** [#578](https://github.com/qnbs/WorldScript-Studio/issues/578), child of [#445](https://github.com/qnbs/WorldScript-Studio/issues/445)

**Status:** `S5_B2_ADMITTED = YES`. Admits the race-free `AuthoritySnapshotGuard` acquisition
mechanism that `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §5.3.3 explicitly left unadmitted (its
"S5-B2 blocker" paragraph). Production implementation not started.

**Baseline:** `docs/native/R15-SECURE-STORAGE-CONTRACT.md` at the S5-A baseline merged in PR #564
(`main` commit `3e89e483`). This document extends that contract's §5.3.1–§5.3.3 without
renegotiating any of their admitted semantics; every term below (`committed_root`,
`AuthoritySnapshot`, `root_generation`, `ACTIVE_READER_PIN`, §5.5's retention rule) is the exact term
S5-A already defines. Where this document says "the parent contract," it means that file.

**Scope:** Race-free `AuthoritySnapshot` acquisition, retention-reference lifetime, generation
reclamation eligibility, reader lifetime, GC interaction, and crash/process-lifetime implications.
Nothing else — this document does not reopen the two-phase secure-anchor commit protocol (§5.3.1),
the digest contract (§5.4), or any other S5-A section.

## 1. The gap this document closes

The parent contract's reader algorithm (§5.3.3) states:

```text
1. acquire shared read admission
2. capture AuthoritySnapshot from the secure anchor and acquire its retention reference
3. resolve ONLY snapshot.committed_root.root_key_ref
...
```

S5-A explicitly left step 2's two actions — capturing the snapshot and registering the retention
reference that keeps its generation alive — unspecified as a single atomic operation. If a reader is
descheduled between them while two further root commits land, its eventual retention reference can
arrive after the generation it names was already reclaimed: a gap in *acquisition*, not *retention*.
No reference counting, epoch scheme, or generation-addressed file layout closes this gap merely by
existing, because §5.5's retention rule and this document's `ACTIVE_READER_PIN` reason both answer
"what stays alive," never "how do you register a pin without a window where it can be missed."

This document defines that missing atomic operation and nothing more. It does not change what stays
alive (§5.5, extended by the parent contract's `ACTIVE_READER_PIN`) or how a root is published
(§5.3.1 step F) — only how a reader safely joins that already-admitted retention set.

## 2. `AuthoritySnapshotGuard`

**Model.** The secure anchor holds its current committed root behind a single atomically-swappable
cell — the exact mechanism is an implementation's own choice (a mutex-guarded reference-counted
handle, a lock-free atomic-swap of a reference-counted handle, or an equivalent construct), but it
MUST provide the following two operations with the atomicity guarantee stated below:

```text
acquire_authority_snapshot_guard() -> AuthoritySnapshotGuard
    = read the current committed-root generation handle
      + increment that exact handle's own reference count
      as one operation indivisible with respect to a concurrent
      commit's replacement of the current handle

release(guard: AuthoritySnapshotGuard)
    = decrement the referenced handle's reference count
```

**Reference implementation sketch (illustrative, not normative wire format).** A conformant Rust
implementation is, for example:

```text
struct RootGenerationHandle { root_generation, root_digest, root_slot, root_key_ref, ... }

current: Mutex<Arc<RootGenerationHandle>>   // or an equivalent lock-free ArcSwap<RootGenerationHandle>

fn acquire_authority_snapshot_guard() -> Arc<RootGenerationHandle> {
    current.lock().clone()   // Arc::clone increments the strong count atomically
}                            // while holding the same lock a commit's replace() uses

fn commit_new_root(next: RootGenerationHandle) {
    *current.lock() = Arc::new(next);   // old Arc's count is now driven only by outstanding guards
}

fn release(guard: Arc<RootGenerationHandle>) {
    drop(guard);   // Arc's Drop decrements the count; reaching zero is the reclamation signal (§3)
}
```

`Arc::clone()` performed while holding the same synchronization primitive (`Mutex`, or an
equivalent single atomic swap point) a writer uses to replace the cell is what provides the
indivisibility in the atomicity requirement below — the clone cannot observe a handle after a
concurrent replace has already dropped the writer's own reference to it, because the replace cannot
proceed until the lock is released. This generalizes without modification to N concurrent readers
racing M concurrent commits: each `clone()` is independently atomic with respect to each `replace()`,
and `Arc`'s reference count is the single source of truth every acquisition and every release agree
on, so no coordination beyond the lock/atomic-swap itself is required for correctness at any
reader/writer concurrency level.

**Publication ordering for `current`.** The parent contract's §5.3.1 step F is the sole durable
publication point; this document's `current` cell is exactly the in-memory reflection of
`secure_anchor.committed_root` for readers, and its replacement (`commit_new_root()` above) MUST
happen as part of the same critical section step F's own implementation uses to durably advance
`committed_root` — never before F durably completes (which would let a guard acquire a
`RootGenerationHandle` for a root that is not yet committed, violating §5.3.1's own ordering) and
never lagging after it completes (which would let a reader admitted after F, per the parent
contract's publication-point rule, still observe the old handle). Concretely: whatever serializes
step F's own durable write (the parent contract's `root_commit_mutex`, §11.1) also guards the
`current` replacement, so "F is durably complete" and "`current` names the new generation" become
one indivisible event from every other thread's perspective. On process restart, `current` holds no
state at all (§4) — Core startup populates it from the durably authenticated `committed_root` via
the parent contract's own cold-start algorithm (§5.3.1), before any caller may reach
`acquire_authority_snapshot_guard()`; there is no separate or divergent bootstrap path for `current`.

**Atomicity requirement (the actual fix).** A concurrent root commit (§5.3.1 step F) replaces the
secure anchor's current-handle cell with a new handle for the new generation. `acquire_authority_
snapshot_guard()` MUST observe exactly one of two outcomes with no third possibility:

- it reads the **prior** handle and increments the prior handle's own reference count, in which case
  step F's replacement — whenever it durably completes — does not, by itself, make the prior
  generation unreferenced (this guard's increment already counts against it); or
- it reads the **new** handle (step F has already completed) and increments the new handle's own
  reference count.

It MUST NOT be possible for the operation to read a handle whose reference count has already reached
zero and been finalized (§3) — equivalently, "read the handle" and "increment its count" are never
separated by a window in which a concurrent commit-and-reclaim sequence can complete against that
same handle. A reference-counted handle behind a single lock or a single atomic swap satisfies this
by construction: cloning a reference-counted pointer while holding the same synchronization primitive
a writer uses to replace it can only observe the pointer that existed at that instant, and the clone's
own increment is visible to any reclamation check that inspects the count afterward — there is no
instant at which the pointer is readable but its target's count is not yet incremented.

**No hazard pointers or RCU required.** This is intentional: reference counting behind one
synchronization point already provides the atomicity above without a separate memory-reclamation
scheme. Do not introduce hazard pointers, epoch-based reclamation, or RCU for `AuthoritySnapshotGuard`
unless a future revision demonstrates the reference-counted model is insufficient for a specific,
named implementation constraint — this is a hard constraint on scope, not a default recommendation
among equals.

**Guard scope.** One guard corresponds to exactly one generation handle (the one captured at
acquisition). The parent contract's reader algorithm step 2 becomes, verbatim:

```text
2. guard := acquire_authority_snapshot_guard()   -- atomic capture + pin, this document
```

and step 7 (`release the retention reference`) becomes `release(guard)`. No other reader-algorithm
step changes.

## 3. Reclamation eligibility

A generation (authority-root, catalog-page, marker, key-epoch control, ordinary data, or any
migration/control generation reachable from a committed root, per the parent contract's "Retention
for pinned reads" paragraph) is reclaimable only when **all** of the following hold together —
satisfying any subset is never sufficient:

1. **Root retention.** It is not reachable from the current `committed_root`, the previous
   `committed_root` (before the most recent publication), a `prepared_root_commit` if present, **or
   the specific root generation any live `AuthoritySnapshotGuard` pins** — this last clause extends
   the parent contract's §5.5 retention set for exactly as long as a guard is live, regardless of how
   many further commits have occurred since acquisition: a guard pinning root generation `N` keeps
   `N` in this retained-root set even after commits advance the current generation to `N+1`, `N+2`,
   and beyond, so it never silently falls out of retention merely because it is no longer "current" or
   "previous." A catalog-page, marker, key-epoch, or data generation is retained by this same
   condition transitively, exactly as §5.5 already defines "referenced by a retained root" for the
   current/previous/prepared cases — extending which roots count as retained is sufficient; no
   separate per-child-generation pin accounting is needed or introduced.
2. **Zero guard references** on the generation's own root handle — this document's reference count
   for that handle is exactly zero (only meaningful for authority-root generations themselves; a
   catalog/marker/data generation's eligibility is governed by condition 1's transitive test, not by
   holding its own reference count).
3. No other admitted recovery-retention reason applies (the parent contract may extend this list in
   the future; this document does not enumerate it exhaustively) — this condition is independent of
   and never subsumed by conditions 1 or 2.

Condition 2 (for a root generation) is `ACTIVE_READER_PIN` from the parent contract's §5.3.3, made
precise: "no admitted reader can still reference the generation" means "the generation handle's
reference count, maintained by this document's guard mechanism, is zero." A root generation failing
condition 1 or condition 2 remains retained exactly as if it were still the previous committed root —
GC treats a guard-extended root, an `ACTIVE_READER_PIN`, and an unresolved condition 3 all with equal
force; none is a softer or best-effort hint, and none may be checked in isolation from the other two.

**Two-lane physical reuse.** The parent contract already requires that an implementation using two
physical root-slot lanes (`ROOT_SLOT_A`/`ROOT_SLOT_B`) create a new generation-addressed
representation rather than overwrite a lane a pinned snapshot still references. This document's
reference count is the exact signal that decision depends on: a lane whose most recent occupant still
has a nonzero reference count is not eligible for in-place reuse, regardless of how long the lane has
been physically idle.

**Finalization is not deletion.** Satisfying all three conditions above makes a generation *eligible*
for reclamation; it does not require immediate physical deletion. An
implementation may batch, defer, or schedule the actual byte-level cleanup, exactly as the parent
contract already treats cleanup as separately retryable elsewhere (§9, §10.3's `RETIRE_OLD_
AUTHORITY`/`FINALIZE` phases). This document constrains only when deletion becomes *permitted*, never
when it must occur.

## 4. Crash and process-lifetime semantics

`AuthoritySnapshotGuard` and its reference counts are pure in-memory constructs with **no durable
representation of any kind** — they are never written to the secure anchor, the authority root, a
journal, or any other persisted structure. This is a deliberate simplification, not an oversight:

- A process crash or restart releases every outstanding guard implicitly, because the in-memory
  reference counts holding them cease to exist along with the process. There is nothing to recover,
  resume, or reconcile for guard state specifically.
- On restart, condition 2 trivially holds (zero guards, because no guards survive a restart) and the
  guard-extended clause of condition 1 contributes no additional retained roots on a fresh process —
  but condition 1's durable §5.5 retention rule and condition 3 (any other admitted recovery-retention
  reason) are unaffected by the restart and still both apply exactly as before it; a restart never
  reduces §3 to condition 1 alone.
- No implementation may persist a guard, a reference count, or any derived "reader still active"
  marker across a restart, and no implementation may treat the *absence* of persisted guard state as
  evidence that reclamation was safe at some point *before* the crash — the durable retention rule
  (§5.5) is the only cross-restart authority, exactly as the parent contract already requires for
  every other authority decision.
- A multi-process or multi-tab scenario (the packaged desktop app run twice, or a future
  multi-window Core) is out of this document's scope: `AuthoritySnapshotGuard` as specified here is a
  single-process, in-memory mechanism. Coordinating reader pins across process boundaries — if ever
  required — needs its own explicit contract and is not implied or half-specified here.

## 5. What this document does not change

- The two-phase secure-anchor commit protocol (§5.3.1) — publication still happens at step F, exactly
  as before.
- §5.5's durable retention conditions (previous/current/prepared root) — this document adds a
  reference-counted precondition on top of them, never a replacement.
- The `AuthoritySnapshot` struct's own fields (§5.3.3) — unchanged.
- Any S5-B1 or S5-B3 domain — migration-source evidence and chunked large-object envelopes are
  unrelated concerns.

## 6. Required proof (headless, before production admission)

- A golden-vector or property test demonstrating: N concurrent `acquire_authority_snapshot_guard()`
  calls racing M concurrent root commits never observe a handle whose reference count was already
  finalized to zero — i.e., every acquired guard's generation remains valid for the guard's full
  lifetime, regardless of interleaving.
- A fault-injection test simulating a reader descheduled between "read current handle" and "increment
  its count" (or the equivalent boundary for the chosen implementation) under a concurrent commit,
  proving the atomicity requirement in §2 holds and not merely "usually holds."
- A reclamation test proving a generation with a nonzero reference count is never selected for
  physical deletion, and a generation satisfying all of §3's conditions eventually becomes eligible
  (no permanent leak from guards that are properly released).
- A process-restart test proving no in-memory guard state is assumed, expected, or required to
  survive a restart, and that reclamation after restart proceeds from §5.5's durable rule alone.
- The parent contract's §5.3.3 "S5-B2 blocker" paragraph, reader-algorithm steps 2/7, header status
  flags, and §21 were updated to reference this document as admitted as part of this document's own
  integration (same PR) — this is a completed integration step, not an outstanding proof item.

## 7. Non-goals

No implementation. No production authority switch. No change to any S5-A digest, envelope, or
migration semantics. No multi-process/multi-window reader coordination (§4). No hazard-pointer or
RCU design (§2) unless a future revision demonstrates necessity.
