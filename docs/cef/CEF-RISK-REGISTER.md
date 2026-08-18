# CEF Desktop Migration — Risk Register

**Companion to:** [`ROADMAP-CEF-DESKTOP-MIGRATION.md`](ROADMAP-CEF-DESKTOP-MIGRATION.md) §76 · [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md)
**Kept as a separate document** (per roadmap §76) so it can be updated per-wave without editing the large roadmap file.
**Established:** Wave 0, 2026-08-18.

Every P0/P1 risk below must have an owner, a test, and an exit condition before the wave that would otherwise be blocked by it begins. `Status` values: `OPEN`, `MITIGATING`, `ACCEPTED_RISK`, `CLOSED`.

| ID | Risk | Severity | Status | Owner | Mitigation | Exit condition |
|---|---|---|---|---|---|---|
| R-01 | Data migration corruption (Tauri→CEF) | Critical | OPEN | *unassigned* | Backup, journal, idempotence, failure injection | Migration rehearsal passes on all fixture classes (§54) with interrupted-migration recovery proven |
| R-02 | Updater defect (bad signature, corrupt download, failed rollback) | Critical | OPEN | *unassigned* | Signatures, staged rollout, rollback rehearsal | RC rehearsal (§63) passes all failure-injection scenarios (§53) |
| R-03 | Unrestricted/unvalidated IPC surface | Critical | OPEN | *unassigned* | Typed allowlist, schema validation, fuzzing | Bridge contract tests (§52) pass; unknown methods rejected |
| R-04 | CEF packaging complexity across 3 platforms | High | OPEN | *unassigned* | Incremental cross-platform CI | Wave 12 packaged artifacts install/launch/uninstall clean on all 3 platforms |
| R-05 | Chromium security patch cadence falls behind upstream | High | OPEN | *unassigned* | Automated monitoring + emergency update lane (§34.1) | Security-SLA dashboard green, no overdue exception (Appendix M.1) |
| R-06 | CEF/Rust/C++ lifetime defects (UB, use-after-free, shutdown races) | High | OPEN | *unassigned* | Minimal wrapper surface, competency harness, dual-review (§4.11.4) | Learning harness (§61.1) green in CI across repeated start/stop cycles |
| R-07 | Memory regression vs. current baseline | High | OPEN | *unassigned* | Per-process attribution (§28), soak tests, numeric budgets | Wave 15 soak passes, no unbounded growth over 2h |
| R-08 | GPU process instability (Wayland/X11/driver-specific) | High | OPEN | *unassigned* | Compatibility matrix (Appendix A.3), recovery path (§30) | Field matrix (§64) passes on NVIDIA/AMD/Intel × Wayland/X11 |
| R-09 | Low-end/resource-constrained device regression | High | OPEN | *unassigned* | L1/L2 budgets, resource-admission layer (§44.6.3) | Low-end qualification gate (§44.6.7) passes |
| R-10 | Documentation drift (stale Tier-A docs more dangerous than missing ones) | High | MITIGATING | *unassigned* | Ownership manifest (`OWNERSHIP.yaml`) established Wave 0. Reconsidered at Wave 1 per this row's own exit condition: `docs:cef-check` remains deferred — Wave 1 produces TS contracts, not CEF/native code, so there is still nothing real for a drift-check to check drift against (same rationale `OWNERSHIP.yaml` already documents). Re-deferred to Wave 2, the first wave with actual CEF host code. | `docs:cef-check` implemented and green in CI |
| R-11 | Feature-parity drift between Tauri and CEF during transition | High | OPEN | *unassigned* | Machine-readable parity ledger (§36 table + `tauri-coupling-inventory.json`) | Tauri retirement gate (§72) — full parity table PASS |
| R-12 | Two-runtime maintenance burden destabilizes both | High | OPEN | *unassigned* | Short-lived parity period, Tauri feature freeze (§69) | CEF Stable cutover (Wave 19) |
| R-13 | Accessibility regression under CEF vs. current web/Tauri baseline | High | OPEN | *unassigned* | Early integration spike (§23.1) + deep certification wave (Wave 16) | Wave 16 exit criteria pass |
| R-14 | Oversized bundled-Chromium footprint hurts low-end adoption | Medium/High | OPEN | *unassigned* | Low-end benchmark, lazy startup | Bake-off (§25) shows acceptable cold-start delta vs. Tauri on L1 |
| **R-15** | **Desktop project-text-at-rest encryption gap** — Tauri filesystem-backed project stores (`services/fs/*Store.ts`) are not encrypted at rest; only the browser/PWA IndexedDB path is (ADR-0018/B-1). Formerly PR #356's scope; PR #363 (merged, v1.27.1) did not cover this — it addressed atomic writes and API-key routing only. | **High** | **OPEN** | *unassigned* | Rebuild on renderer-neutral `worldscript-crypto` (§20) with migration journal, admission lock, AAD, binary-asset coverage, recovery — same rigor as ADR-0018's IDB path. Do not patch the stale PR #356 implementation into the current architecture. | Wave 7 exit: desktop security claims truthful and tested (roadmap §71 Security gate) |
| R-16 | Desktop credential storage remains OS-filesystem-based, not platform-keychain | Medium | OPEN | *unassigned* | PR #363 already fixed the immediate secret-material flaw (fail-closed routing, legacy key discard); full Keychain/Credential-Manager/Secret-Service integration deferred | Wave 7 exit: `worldscript-crypto`/credential storage matches §21 hierarchy |
| R-17 | Rust/Tauri CI gate (ex-PR #353) content is lost if closed without extraction | Low | MITIGATING | *unassigned* | Confirmed superseded by PR #363's shipped "🦀 Tauri Rust Gate" (verified passing on `main` as of 2026-08-18); diff before close (§65) | #353 closed with cited delta-check; nothing unique left unmerged |
| R-18 | Atomic-writes correctness delta (ex-PR #354) lost if closed without extraction | Low | MITIGATING | *unassigned* | Confirmed same scope as PR #363's shipped atomic-write work; diff before close (§65) | #354 closed with cited delta-check; nothing unique left unmerged |

## Provenance

R-15–R-18 were derived directly from the Wave 0 PR reconciliation (roadmap §65), which is itself based on verified `gh pr view`/`gh pr list` output against `qnbs/WorldScript-Studio` on 2026-08-18 — not the original roadmap draft's guessed PR content. R-01–R-14 are carried over from the roadmap draft's §76 table, expanded with explicit owner/status/exit-condition columns per this register's format.

## Review cadence

This register should be reviewed at the exit of every Wave (roadmap §67) and whenever a new P0/P1-class finding surfaces. Owners are intentionally unassigned as of Wave 0 — assign before the corresponding wave begins, not before.
