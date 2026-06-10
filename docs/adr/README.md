# Architecture Decision Records (ADRs)

Short, immutable records of significant architectural decisions — the *why* behind choices that
audits and new contributors keep re-asking about. Supersede an old decision with a new ADR rather
than editing history.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-state-management-boundaries.md) | State-management boundaries: Redux Toolkit vs Zustand | Accepted |
| [0002](0002-local-ai-stack-layering.md) | Local-AI stack layering and fallback chain | Accepted |
| [0003](0003-workerbus-hybrid-routing.md) | WorkerBus v2 hybrid routing and the Rust TaskSupervisor | Accepted |
| [0004](0004-csp-connect-src-byok-tradeoff.md) | CSP `connect-src` and the BYOK `https:` tradeoff | Accepted |

**Format:** Context → Decision → Consequences (incl. rejected alternatives). Keep each ADR to one
decision. Link related records with `[[slug]]`.
