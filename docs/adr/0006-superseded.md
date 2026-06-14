# ADR 0006 — (reserved, never issued)

## Status

Superseded / void — 2026-06-14

## Context

ADR number **0006** was reserved during planning but no decision record was ever written against
it; the next accepted decision was filed as [[0007-plugin-sandbox-model]]. An audit on 2026-06-14
flagged the gap in the `docs/adr/` sequence (0005 → 0007). To keep the sequence gapless and
auditable — and to avoid renumbering 0007 (which would break inbound `[[slug]]` links and external
references) — this tombstone occupies the slot.

## Decision

Retire number 0006 permanently. It will **not** be reused for a future decision; new ADRs continue
from the current high-water mark. No architectural decision is encoded here.

## Consequences

- The `docs/adr/` index is gapless and the missing-number audit finding is resolved.
- No links break, since nothing referenced 0006.
- See the active records: [[0005-webllm-worker-offload]] and [[0007-plugin-sandbox-model]].
