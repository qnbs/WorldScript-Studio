# StoryCraft ProForge Ultimate Author Pipeline (UAP)

**Status:** v1.1.0 — Humanization & Refinement Sprint complete (Phases H/A/P/X)  
**Last Updated:** 27 May 2026  
**Feature Flag:** `enableProForge` (default: `false`)  

---

## Overview

The **ProForge Ultimate Author Pipeline** is an agentic, 8-stage manuscript quality and production pipeline integrated directly into the Writer view. It transforms the existing tool-centric AI writer into a full **Human-in-the-Loop** editorial workflow — from raw draft to print- and publication-ready manuscript.

### Architecture Principles

| Principle | Implementation |
|-----------|---------------|
| **Agentic Multi-Agent** | Each stage has a dedicated agent with specialized tools |
| **Human-in-the-Loop** | No automatic manuscript modification without explicit approval |
| **Privacy-First** | All processing client-side; no cloud dependency for the pipeline itself |
| **Quality Supervised** | `SupervisorAgent` applies heuristic gates and triggers retries without calling any AI |
| **Self-Evaluating** | `BaseAgent.selfReflect()` checks its own output for coherence before surfacing to author |
| **Full Audit Trail** | Every action logged; every stage snapshot-backed; `isFallback` + `reflectionNotes` in output |
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
- **Output:** `DiagnosticReport` — profile, consistency issues, structural gaps, quality score 0–100
- **Hard gate:** If `qualityScore < 30`, the `SupervisorAgent` fails the pipeline immediately (manuscript not ready for editing)
- **Self-evaluation:** Runs `selfReflect()` and sets `reflectionNotes` on INCOHERENT output

### Stage 2: Developmental / Structural
- **Agent:** `StructuralAgent`
- **Purpose:** Macro-structure fixes: pacing, arcs, chapter boundaries
- **Output:** `StructuralEditPlan` — edits with rationale, pacing report
- **Self-evaluation:** Runs `selfReflect()` on INCOHERENT flag; re-runs the analysis before surfacing to author

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
  proForgeOrchestrator.ts     # Central orchestrator + executeStageWithSupervision loop
  proForgeMemoryBank.ts       # IndexedDB-backed project memory
  pipelineAgents/
    baseAgent.ts              # Abstract base class (~200 LOC saved across 8 agents)
    supervisorAgent.ts        # Heuristic quality gate — no AI calls
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
services/ai/aiConstants.ts    # CREATIVITY_TO_TEMPERATURE, ORCHESTRATION_READY_PROVIDERS
features/featureFlags/        # Added enableProForge flag
app/store.ts                  # Added proForge reducer
```

---

## BaseAgent Abstract Class

All 8 pipeline agents extend `BaseAgent` (`services/proForge/pipelineAgents/baseAgent.ts`):

```typescript
export abstract class BaseAgent {
  protected readonly context: OrchestratorContext;
  constructor(context: OrchestratorContext) { this.context = context; }

  // Implemented by each agent
  abstract execute(signal: AbortSignal): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>>;

  // Shared helpers
  protected requireProject(): StoryProject { ... }
  protected getMemoryBank(): ProForgeMemoryBank { ... }
  protected elapsed(startTime: number): number { ... }

  // Self-evaluation — checks AI output for coherence before returning to orchestrator
  protected async selfReflect(
    manuscriptExcerpt: string,
    analysisSummary: string,
    signal: AbortSignal,
  ): Promise<{ coherent: boolean; note: string; tokensUsed: number }> { ... }
}
```

Benefits: constructor boilerplate, `requireProject`, `getMemoryBank`, `elapsed` helpers, and `selfReflect` are shared — agents implement only `execute()`.

---

## SupervisorAgent

`services/proForge/pipelineAgents/supervisorAgent.ts` — pure heuristic quality gate, **no AI calls**:

```typescript
export class SupervisorAgent {
  evaluate(stage: PipelineStage, result: StageResult): SupervisionDecision
}
```

`SupervisionDecision` shape:
```typescript
interface SupervisionDecision {
  verdict: 'pass' | 'retry' | 'fail';
  reason: string;
  retryHint?: string;
}
```

**Decision rules per stage:**
- `intake`: Detects uniform 50/100 fallback sentinel (all scores = exactly 50) → retry. `qualityScore < 30` → fail (hard gate).
- `structural`: If edit count > word count / 10 → retry (over-aggressive edits).
- `proof`: If grammar issue count > word count / 20 → retry (implausible density).
- All stages: `isFallback: true` on output → retry (up to `maxRetries` times).

---

## Orchestrator Supervision Loop

`proForgeOrchestrator.ts` runs each stage through `executeStageWithSupervision`:

```
for each selected stage:
  attempt = 0
  loop:
    result = await agent.execute(signal)
    decision = supervisorAgent.evaluate(stage, result)
    if decision.verdict === 'pass' OR attempt >= maxRetries:
      dispatch stageCompleted / stageAwaitingReview
      break
    attempt++
    (retry with updated context)
```

`maxRetries` (default `1`) is set in `PipelineConfig`. Set to `0` to disable supervision retries.

---

## Self-Evaluation Loop

`DiagnosticAgent` and `StructuralAgent` call `this.selfReflect(excerpt, summary, signal)` after receiving AI output. If the result is flagged as `INCOHERENT`:

1. `reflectionNotes` is populated with the AI's self-critique (not shown to author; visible in trace log).
2. The agent re-runs its analysis one time.
3. If still incoherent after re-run, it proceeds with the `reflectionNotes` attached so the `SupervisorAgent` can decide on retry.

---

## Honest Fallback Reports

All `createFallback*` methods produce outputs with:
- **0 scores** (not fake mid-range values that could mislead quality gates)
- **`isFallback: true`** flag on the output type
- A clear `reason` string explaining why the fallback was triggered

The `SupervisorAgent` detects `isFallback: true` and schedules a retry up to `maxRetries`.

---

## PipelineReviewPanel (P-5 Redesign)

The review panel at `components/proForge/PipelineReviewPanel.tsx` now shows:

1. **Critical Actions Summary Card** — compact listing of all `severity: 'critical'` items at the top, always visible.
2. **Severity-grouped view** — three sections: Critical → Warnings → Suggestions, each collapsible.
3. **Quick Accept High-Confidence** button — accepts all `ReviewItem`s where:
   - `confidence >= 0.85`
   - `severity !== 'critical'`
   - `status === 'pending'`

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
| `failed` | Stage execution error (or SupervisorAgent hard-fail) |

### Review System
Every edit, issue, or suggestion produced by an agent becomes a `ReviewItem`:
- `pending` → `accepted` | `rejected` | `ignored`
- Batch operations: Accept All / Reject All per category
- Per-item rationale and confidence score
- Quick Accept for high-confidence non-critical items (≥ 0.85)

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
| `maxRetries` | `1` | Supervisor retry limit per stage (0 = no retries, max 1) |
| `language` | `en` | Output language for agent prose |
| `useDuckDb` | `false` | Enable DuckDB analytics dual-write |

---

## Type Reference

Key types added in the Humanization Sprint:

```typescript
// Fallback marker — SupervisorAgent detects and triggers retry
interface DiagnosticReport { isFallback?: boolean; ... }
interface StructuralEditPlan { isFallback?: boolean; reflectionNotes?: string; ... }
interface QualityGateReport { isFallback?: boolean; ... }

// Self-evaluation result — stored for trace log, not shown in UI
// (on DiagnosticReport and StructuralEditPlan)
reflectionNotes?: string;

// Supervisor decision — attached to StageResult after supervision
interface SupervisionDecision {
  verdict: 'pass' | 'retry' | 'fail';
  reason: string;
  retryHint?: string;
}
// On StageResult:
supervisorDecision?: SupervisionDecision;
```

---

## Enabling ProForge

1. Go to **Settings → Experimental Features**
2. Toggle **"ProForge Pipeline"**
3. Open the **Writer view** — the ProForge Dashboard tab appears

---

## Integration with Writer View (Phase X)

### Settings Navigation Groups (X-1)

Settings sidebar now uses semantic `NAV_GROUPS` with `NavGroupHeader` dividers:
- **Writing** — Editor, Advanced Editor, Writing AI
- **AI Models** — AI Provider, Advanced AI, LoRA Adapters
- **Appearance & Accessibility** — Appearance, Accessibility
- **Privacy & Data** — Privacy, Data, Backup
- **Connections** — Collaboration, Integrations, Notifications, Community
- **System** — Performance, Plugins, Shortcuts, Guide, Experimental, About

### Flow Mode (X-2)

Distraction-free writing toggle in the Writer view toolbar:
- Collapses all sidebars and ProForge panel chrome
- Activated via toolbar button; exits with `Escape`
- State stored in `app/transientUiStore.ts` (`flowMode` / `setFlowMode`) — resets on page load

### Empty States (X-3)

`<EmptyState>` contextual guidance when collections are empty:
- **Characters** — prompt to add first character
- **World** — prompt to create first world
- **SceneBoard** — prompt to start planning
- **ProForge Dashboard** — prompt to enable the feature or start the pipeline

---

## Future Roadmap

| Version | Feature |
|---------|---------|
| v1.19 | PLANbib v1.7 features (Objects, MindMap, Character Interviews, Timeline, Analysis) |
| v2.1 | Collaborative multi-agent consensus, custom agent builder |
| v2.2 | Multi-language pipeline, audiobook generation |
| v2.3 | Market analysis agent, A/B testing for edits |
| v2.4 | Continuous background pipeline, agent marketplace |

---

*See `CLAUDE.md` for engineering conventions and `docs/CI.md` for testing requirements.*
