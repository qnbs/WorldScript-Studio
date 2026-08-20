# Historical record: CEF desktop-runtime program (retired)

WorldScript Studio investigated Chromium Embedded Framework (CEF) as a candidate next-generation
desktop runtime between 2026-08-18 and 2026-08-20. That program is **retired** — CEF is not part of
the target architecture. See [ADR-0021](../../adr/0021-qt-gpui-native-desktop-strategy.md), which
supersedes [ADR-0019](../../adr/0019-cef-desktop-runtime-strategy.md) (CEF as next-gen runtime) and
[ADR-0020](../../adr/0020-cef-binding-choice-thin-cpp-host.md) (thin C++ host + Rust core binding
choice).

**Status of this document:** written as part of Wave 0 PR A (the strategic-reset decision), which
establishes ADR-0021 but does not itself remove any CEF source or CI. The actual removal described
below happens in the companion Wave 0 PR B, which opens only after PR A merges. Until PR B merges,
the paths named below still exist on `main`.

## Why

A real Wave 2 spike got the Linux CEF sandbox genuinely operational for renderer processes, but
surfaced a structural blocker tracked as **R-19 / Issue #405**: under Linux's default Yama
`ptrace_scope=1`, Crashpad's `PtraceStrategyDecider` cannot produce sandboxed-renderer crash dumps
without weakening the sandbox. That trade was not acceptable. ADR-0021 has the full decision record,
including the alternatives considered and why each was rejected.

## What will be removed (Wave 0 PR B)

`apps/desktop-cef/` (the C++ host + FFI-boundary Rust scaffold), `scripts/cef/` (SDK-fetch/build/
proof tooling), `.github/workflows/cef-learning-harness.yml` (advisory-only CI, never part of the
required `ci-success` gate), and 14 of the 15 files under `docs/cef/` (roadmap, risk register,
competency matrix, ownership manifest, binding scorecard, and knowledge-base articles).

`docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` will **not** be deleted — it will be relocated to
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

Companion GitHub state (Wave 0 PR B): PR #404 (the real sandbox-enable attempt) will be closed
unmerged, not deleted — its investigative work remains visible history. Issue #405 (R-19) will be
closed as "no longer applicable to the target architecture," explicitly not "fixed" — the Crashpad
root cause it documented remains real and correctly diagnosed; it is simply no longer WorldScript's
problem to solve. Both remain open as of PR A.
