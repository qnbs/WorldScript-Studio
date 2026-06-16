# ADR 0008 — Local-first data model: Yjs document as source of truth

- **Status:** Accepted (decision made; migration staged behind a gate)
- **Date:** 2026-06-15
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, state, local-first, data-model, migration

## Context

WorldScript Studio is **offline-first** (encrypted IndexedDB + Tauri FS persistence, `redux-undo` history)
but **not local-first** in the CRDT sense. `services/collaborationService.ts` instantiates an
*ephemeral* `Y.Doc` only on `connect()` and exposes one `getSharedText('manuscript')` seam; the
manuscript's source of truth is a plain Redux object (`ProjectData`, `StorySection.content: string`).
The editor never reads or writes through Yjs — so multi-device sync, offline-merge, and conflict-free
collaboration are unbuilt, and the Yjs dependency is inert *as a data-model technology*.

[[0001-state-management-boundaries]] assigns persisted domain data (project, manuscript, characters,
world…) to Redux Toolkit + `redux-undo`. That was correct for a single-device serialization model,
but a serialization-shaped POJO is the wrong shape for fine-grained merge: two array/string LWW
replicas cannot converge a paragraph edited concurrently without losing a side.

A proof of concept (B0.1, strategic plan §5/§8) validated the alternative before committing:
`services/localFirst/projectDoc.ts` maps `ProjectData ↔ Y.Doc` and `tests/unit/localFirst/projectDoc.test.ts`
proves round-trip fidelity, **char-level concurrent same-section merge keeping both edits**,
section-level merge, and `Y.UndoManager` undo/redo. The gate passed.

## Decision

**One `Y.Doc` per project becomes the canonical store; Redux is demoted to a derived read-model.**

Schema (per project):

| Domain field | Yjs type | Notes |
|---|---|---|
| `manuscript` | `Y.Array<Y.Map>` | one map per section; order = array order |
| `StorySection.content` | `Y.Text` | char-level CRDT merge — the headline win |
| other section scalars | `Y.Map` keys | LWW per key |
| `characters`, `worlds` | `Y.Map<id, entity>` | `EntityState` rebuilt via the RTK adapters on read |
| everything else (`title`, `logline`, `outline`, goals…) | `meta` `Y.Map` | small, LWW |
| ephemeral UI (plotBoard viewport, copilot, voice, command palette…) | **stays Redux/Zustand** | **never** CRDT — [[0001-state-management-boundaries]] unchanged |

Supporting decisions:

- **Yjs, not Automerge.** Yjs is already vendored, security-reviewed, and transport-integrated (the
  `packages/collab-transport` y-webrtc fork with RTCDataChannel E2E). Switching libraries would
  discard a year of hardening for ergonomic gains that do not change the outcome.
- **`redux-undo` → `Y.UndoManager` at the flip.** Two undo models cannot both own the same truth; the
  CRDT-native history becomes the single source once a project is on Yjs.
- **Redux selectors and component reads are unchanged.** A binding (`docBinding`) observes the doc and
  dispatches a single `project/hydrateFromDoc`; the editor writes through Yjs transactions. This
  preserves the entire existing UI and test surface — essential for an indie team.
- **The flip is gated and per-project, behind `enableLocalFirstSync` (off by default).** A project
  that has flipped keeps a POJO backup until confirmed stable; the flip is a **one-way door** per
  project, so it ships dark and is enabled only after the B0.1 gate + a Phase-1 CI read-verify both
  pass. Persistence (`y-indexeddb` + Tauri update-log) and sync (file-based → P2P → optional relay)
  layer on after the flip.

This ADR **supersedes the persistence / source-of-truth half** of [[0001-state-management-boundaries]]
for project *domain* data. It does **not** change the ephemeral-state half: transient UI stays in
Zustand/Redux exactly as before.

## Consequences

- **Positive:** true offline-merge and multi-device become possible on the existing E2E transport; a
  single coherent edit history; char-level conflict resolution that a string model cannot provide;
  the substrate (Yjs, crypto, worker bus) is already present.
- **Negative:** the migration is the highest-risk work item in the roadmap; flipping the canonical
  store is irreversible per project; during the transition two mental models coexist (mitigated by the
  shadow phase keeping `redux-undo` until the flip, and by this ADR).
- **Rejected — stay offline-only / single-device:** caps the product at "an excellent single-device
  writer" when the parts for the local-first category leader already exist.
- **Rejected — shadow doc permanent (Redux stays SoT):** a derived Redux cannot merge; you get sync
  plumbing without the conflict-free guarantee, and you maintain two histories forever.
- **Rejected — Automerge:** see above; discards vendored, security-reviewed Yjs + transport.

## References

- PoC: `services/localFirst/projectDoc.ts`, `tests/unit/localFirst/projectDoc.test.ts` (B0.1 gate)
- Baseline: A0.1 perf harness (`tests/bench/`) — the before/after gate for the migration
- Strategic plan: `/home/pc/.claude/plans/master-prompt-strategic-snazzy-duckling.md` (§3, §5, §7, §8)
- [[0001-state-management-boundaries]] (superseded in part), `services/collaborationService.ts`,
  `packages/collab-transport`
- **0009 (planned)** — sync threat model (signaling metadata, E2E guarantees, opt-in posture)
