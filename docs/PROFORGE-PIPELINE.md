# StoryCraft ProForge Ultimate Author Pipeline (UAP)

**Status:** v1.0.0 — Foundation + All 8 Agents Implemented  
**Last Updated:** 24 May 2026  
**Feature Flag:** `enableProForge` (default: `false`)  

---

## Overview

The **ProForge Ultimate Author Pipeline** is an agentic, 8-stage manuscript quality and production pipeline integrated directly into the KI Schreibstudio (Writer view). It transforms the existing tool-centric AI writer into a full **Human-in-the-Loop** editorial workflow — from raw draft to print- and publication-ready manuscript.

### Architecture Principles

| Principle | Implementation |
|-----------|---------------|
| **Agentic Multi-Agent** | Each phase has a dedicated agent with specialized tools |
| **Human-in-the-Loop** | No automatic manuscript modification without explicit approval |
| **Privacy-First** | All processing client-side; no cloud dependency for the pipeline itself |
| **Modular & Plugin-Ready** | New stages and tools can be registered via the plugin system |
| **Full Audit Trail** | Every action logged; every stage snapshot-backed |
| **Genre-Aware** | Templates and agents adapt to genre preset and style guide |

---

## The 8 Stages

```
[Idle] → [1. Intake] → [2. Structural] → [3. Line/Prose] → [4. Copy Edit]
                                              ↓
[5. Proof] → [6. Production] → [7. Publishing] → [8. Analytics] → [Archived]
```

Each stage supports: `proceed` | `retry` | `skip` | `abort` | `rollback`

### Stage 1: Intake & Diagnostic
- **Agent:** `DiagnosticAgent`
- **Purpose:** Analyze manuscript structure, detect consistency issues, compute quality scores
- **Output:** `DiagnosticReport` (JSON) — profile, consistency issues, structural gaps, quality score 0-100

### Stage 2: Developmental / Structural
- **Agent:** `StructuralAgent`
- **Purpose:** Macro-structure fixes: pacing, arcs, chapter boundaries
- **Output:** `StructuralEditPlan` — edits with rationale, pacing report

### Stage 3: Line & Prose Correction
- **Agent:** `ProseAgent`
- **Purpose:** Show-don't-tell, filter words, dialogue polish, POV consistency, sensory details
- **Output:** `ProseEditBatch` — per-edit before/after with confidence scores

### Stage 4: Copy Editing & Language Polish
- **Agent:** `CopyEditAgent`
- **Purpose:** Grammar, style consistency, repetition detection, formatting
- **Output:** `CopyEditPlan` — grammar edits, style edits, repetition hits

### Stage 5: Proofreading & Quality Gate
- **Agent:** `ProofAgent`
- **Purpose:** Final error sweep, legal scan, readability assessment
- **Output:** `QualityGateReport` — pass/fail per category with legal warnings

### Stage 6: Production & Formatting
- **Agent:** `ProductionAgent`
- **Purpose:** Generate PDF, EPUB, DOCX, Markdown artifacts
- **Output:** `ProductionManifest` — downloadable artifact list

### Stage 7: Publishing Preparation
- **Agent:** `PublishingAgent`
- **Purpose:** Metadata, blurbs, audiobook guide, marketing assets
- **Output:** `PublishingPackage` — complete publishing kit

### Stage 8: Analytics & Archive
- **Agent:** `AnalyticsAgent`
- **Purpose:** Aggregate metrics, lessons learned, archive preparation
- **Output:** `PipelineAnalyticsReport` — full pipeline metrics

---

## File Structure

```
features/proForge/
  types.ts                    # Pipeline types, schemas, state shapes
  proForgeSlice.ts            # Redux slice with stage machine

services/proForge/
  proForgeOrchestrator.ts     # Central orchestrator state machine
  proForgeMemoryBank.ts       # IndexedDB-backed project memory
  pipelineAgents/
    diagnosticAgent.ts        # Stage 1
    structuralAgent.ts        # Stage 2
    proseAgent.ts             # Stage 3
    copyEditAgent.ts          # Stage 4
    proofAgent.ts             # Stage 5
    productionAgent.ts        # Stage 6
    publishingAgent.ts        # Stage 7
    analyticsAgent.ts         # Stage 8
  pipelineTools/
    toolRegistry.ts           # Tool-calling registry + built-in tools
  pipelineOutput/
    structuredOutput.ts       # Zod schemas for all AI outputs

services/promptLibrary.ts     # Extended with 6 ProForge prompt templates
features/featureFlags/        # Added enableProForge flag
app/store.ts                  # Added proForge reducer
```

---

## State Machine

The pipeline uses a Redux-backed state machine (`proForgeSlice.ts`):

| State | Description |
|-------|-------------|
| `idle` | No active pipeline |
| `running` | A stage is executing |
| `awaitingReview` | Stage complete, waiting for Human-in-the-Loop approval |
| `completed` | All selected stages finished |
| `aborted` | Pipeline cancelled by user |
| `failed` | Stage execution error |

### Review System
Every edit, issue, or suggestion produced by an agent becomes a `ReviewItem`:
- `pending` → `accepted` | `rejected` | `ignored`
- Batch operations: Accept All / Reject All per category
- Per-item rationale and confidence score

### Snapshots
- **Pre-pipeline snapshot:** Auto-created at start
- **Pre-stage snapshot:** Created before each stage
- **Post-stage snapshot:** Created after review acceptance
- Rollback restores any pre-stage snapshot

---

## Tool Calling

Agents use the `toolRegistry` (`services/proForge/pipelineTools/toolRegistry.ts`) to interact with the manuscript:

| Tool | Purpose | Stages |
|------|---------|--------|
| `readSection` | Read full section content | All |
| `readAllSections` | List all sections (metadata) | All |
| `readProjectMeta` | Read title, logline, characters, worlds | All |
| `searchLore` | Search memory bank for lore | All |
| `analyzePacing` | Compute tension scores per section | Intake, Structural |
| `countWords` | Word count statistics | All |
| `generateReport` | Save structured report to memory bank | All |
| `getMemoryContext` | Retrieve relevant memory context | All |
| `proposeEdit` | Queue an edit for Human-in-the-Loop review | Structural, Prose, CopyEdit |

---

## Memory Bank

The `ProForgeMemoryBank` (`services/proForge/proForgeMemoryBank.ts`) provides persistent, project-specific context across stages:

- **Storage:** IndexedDB (`proforge-memory-bank`)
- **Categories:** `lore` | `character` | `style` | `feedback` | `edit` | `meta`
- **Retrieval:** Keyword search + stage-aware filtering
- **Context Building:** Automatically assembles memory blocks for prompt injection

---

## Configuration

Pipeline configuration (`PipelineConfig`) includes:

| Field | Default | Description |
|-------|---------|-------------|
| `genrePreset` | `general-fiction` | Genre template for analysis criteria |
| `styleGuide` | — | Custom style guide override |
| `selectedStages` | All 8 | Which stages to execute |
| `aiProvider` | `gemini` | Primary AI provider |
| `ragMode` | `hybrid` | RAG retrieval mode |
| `maxTokens` | `8000` | Token limit per call |
| `creativity` | `Balanced` | Temperature mapping |
| `autoAcceptThreshold` | `0` | Auto-accept edits above confidence (0 = never) |

---

## Enabling ProForge

1. Go to **Settings → Experimental Features**
2. Toggle **"ProForge Ultimate Author Pipeline"**
3. Open **KI Schreibstudio** — the ProForge Dashboard tab appears

---

## Future Roadmap

| Version | Feature |
|---------|---------|
| v2.1 | Collaborative multi-agent consensus, custom agent builder |
| v2.2 | Multi-language pipeline, audiobook generation |
| v2.3 | Market analysis agent, A/B testing for edits |
| v2.4 | Continuous background pipeline, agent marketplace |

---

*See AGENTS.md for coding conventions and `docs/CI.md` for testing requirements.*
