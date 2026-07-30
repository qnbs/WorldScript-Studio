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
| [0005](0005-webllm-worker-offload.md) | WebLLM inference offloaded to a dedicated WorkerBus v2 pool | Accepted |
| [0006](0006-superseded.md) | (reserved, never issued) | Superseded / void |
| [0007](0007-plugin-sandbox-model.md) | Plugin Sandbox Model | Accepted |
| [0008](0008-local-first-data-model.md) | Local-first data model: Yjs document as source of truth | Accepted |
| [0009](0009-xstate-workflow-orchestration.md) | XState for complex workflow orchestration (Redux + RTK Query + XState) | Accepted |
| [0010](0010-languagetool-self-hosted.md) | Self-hosted LanguageTool grammar checking via the editor overlay | Accepted |
| [0011](0011-ai-heuristic-fallbacks.md) | AI heuristic fallbacks via a registry + provider-layer seam | Accepted |
| [0012](0012-local-server-connectivity-tauri-http.md) | Local AI server connectivity: route localhost HTTP through the Tauri HTTP plugin | Accepted |
| [0013](0013-csp-wasm-and-blob-frames.md) | CSP `'wasm-unsafe-eval'` and `frame-src blob:` | Accepted |
| [0014](0014-worker-generation-duplication.md) | Two live worker generations (v1 and WorkerBus v2) | Superseded by 0015 |
| [0015](0015-worker-generation-consolidation.md) | Worker-generation consolidation: v1 retired, WorkerBus v2 is the sole generation | Accepted |

**Format:** Context → Decision → Consequences (incl. rejected alternatives). Keep each ADR to one
decision. Link related records with `[[slug]]`.
