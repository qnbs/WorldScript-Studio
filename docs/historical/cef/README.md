# Historical record: CEF desktop-runtime program (retired)

WorldScript Studio investigated Chromium Embedded Framework (CEF) as a candidate next-generation
desktop runtime between 2026-08-18 and 2026-08-20. That program is **retired** — CEF is not part of
the target architecture. See [ADR-0021](../../adr/0021-qt-gpui-native-desktop-strategy.md), which
supersedes [ADR-0019](../../adr/0019-cef-desktop-runtime-strategy.md) (CEF as next-gen runtime) and
[ADR-0020](../../adr/0020-cef-binding-choice-thin-cpp-host.md) (thin C++ host + Rust core binding
choice).

**Status of this document:** ADR-0021 and the strategic-reset decision merged as Wave 0 PR A (PR
#406). The actual removal described below is staged in the companion Wave 0 PR B (this PR), open
and pending merge as of this writing. Until PR B merges, the paths named below still exist on
`main`.

## Why

A real Wave 2 spike got the Linux CEF sandbox genuinely operational for renderer processes, but
surfaced a structural blocker tracked as **R-19 / Issue #405**: under Linux's default Yama
`ptrace_scope=1`, Crashpad's `PtraceStrategyDecider` cannot produce sandboxed-renderer crash dumps
without weakening the sandbox. That trade was not acceptable. ADR-0021 has the full decision record,
including the alternatives considered and why each was rejected.

## What is removed (Wave 0 PR B, staged in this PR pending merge)

`apps/desktop-cef/` (the C++ host + FFI-boundary Rust scaffold), `scripts/cef/` (SDK-fetch/build/
proof tooling), `.github/workflows/cef-learning-harness.yml` (advisory-only CI, never part of the
required `ci-success` gate), and 14 of the 15 files under `docs/cef/` (roadmap, risk register,
competency matrix, ownership manifest, binding scorecard, and knowledge-base articles).

`docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` was **not** deleted — it was relocated to
[`docs/native/UI-DOMAIN-STATE-CLASSIFICATION.md`](../../native/UI-DOMAIN-STATE-CLASSIFICATION.md)
because its Redux domain/UI-state classification is independent of renderer and remains directly
useful for the future Rust Core migration-priority work.

## Where the real archive is

Git history is the archive, not this directory. Once PR B merges, `git log --oneline -- docs/cef/
apps/desktop-cef/ scripts/cef/ .github/workflows/cef-learning-harness.yml` reconstructs the full
history regardless of any tag or branch. The companion PRs for this reset are the most direct
before/after reference: PR #384/#385 (Wave 1, `DesktopPlatform` boundary — still current, unaffected
by this retirement) and the Wave 0 strategy-reset (PR A) and cleanup (PR B) PRs that remove the paths
above.

Companion GitHub state: PR #404 (the real sandbox-enable attempt) is closed unmerged, not deleted —
its investigative work remains visible history. Issue #405 (R-19) is closed as "no longer applicable
to the target architecture," explicitly not "fixed" — the Crashpad root cause it documented remains
real and correctly diagnosed; it is simply no longer WorldScript's problem to solve. Both closed once
ADR-0021 existed on `main` (after PR A merged), independent of PR B's own merge status.
