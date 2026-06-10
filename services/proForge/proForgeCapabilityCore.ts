/**
 * ProForge Capability Core — environment-agnostic ports + pure operations.
 * QNBS-v3: The hexagonal seam between the Core Capability Layer and its runtimes. Imports ONLY
 * ProForge types, the InferenceGateway *type*, and pure helpers — never Redux, IndexedDB, or browser
 * globals. The browser adapter and the Node/MCP adapter each implement these ports.
 */

import {
  DEFAULT_PIPELINE_CONFIG,
  type MemoryBankEntry,
  type PipelineConfig,
  type PipelineRun,
  type PipelineStage,
  type ReviewItem,
  type StageMetrics,
  type SupervisionDecision,
} from '../../features/proForge/types';
import type { InferenceGateway } from '../ai/inferenceGateway';
import { planAcceptedManuscriptEdits } from './applyReviewEdits';
import type { MemoryRagMode } from './proForgeMemoryBank';
import type { OrchestratorContext } from './proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Project snapshot (what runStage feeds agents — a ProjectData-compatible subset)
// ---------------------------------------------------------------------------

export interface ProForgeProjectSnapshot {
  id: string;
  title: string;
  logline: string;
  manuscript: Array<{ id: string; title: string; content: string }>;
  characters: Array<{ id: string; name: string }>;
  worlds: Array<{ id: string; name: string }>;
  /** Optional outline — agents read it defensively (`project.outline?.…`). */
  outline?: Array<{ title: string; description?: string }>;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Gateway port is exactly the existing InferenceGateway contract. */
export type ProForgeGatewayPort = InferenceGateway;

/** Memory-bank port — the subset of ProForgeMemoryBank the capability layer needs. */
export interface ProForgeMemoryPort {
  search(query: string, limit?: number, mode?: MemoryRagMode): Promise<MemoryBankEntry[]>;
  remember(
    category: MemoryBankEntry['category'],
    key: string,
    content: string,
    sourceStage: PipelineStage,
  ): Promise<MemoryBankEntry>;
  recall(category?: MemoryBankEntry['category']): Promise<MemoryBankEntry[]>;
}

/** Run-history port — load/save completed runs for a project. */
export interface ProForgeHistoryPort {
  load(projectId: string): Promise<PipelineRun[]>;
  save?(projectId: string, runs: PipelineRun[]): Promise<void>;
}

/** Project port — resolve the live/portable project snapshot by id. */
export interface ProForgeProjectPort {
  get(projectId: string): ProForgeProjectSnapshot | null;
}

/** The full set of ports a ProForgeCapabilityLayer needs to operate. */
export interface ProForgeCapabilityPorts {
  gateway: ProForgeGatewayPort;
  /** Resolve the memory bank for a given project. */
  memory(projectId: string): ProForgeMemoryPort;
  history: ProForgeHistoryPort;
  project: ProForgeProjectPort;
  /** Feature-flag / permission gate — returns true when ProForge ops are allowed. */
  isEnabled(): boolean;
}

// ---------------------------------------------------------------------------
// Op result shapes
// ---------------------------------------------------------------------------

export interface RunStageResult {
  stage: PipelineStage;
  reviewItems: ReviewItem[];
  metrics: StageMetrics;
  agentOutput: unknown;
  supervisorDecision: SupervisionDecision;
}

export interface ApplyEditsResultSummary {
  updates: Array<{ id: string; content: string }>;
  applied: number;
  skipped: number;
  dryRun: boolean;
}

export interface SupervisorStatusEntry {
  stage: PipelineStage;
  supervisorDecision: SupervisionDecision | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Pure operations (no IO)
// ---------------------------------------------------------------------------

/** Pure applyEdits — delegates to the offset-safe manuscript planner. */
export function applyEditsPure(
  manuscript: ReadonlyArray<{ id: string; content?: string }>,
  items: ReadonlyArray<ReviewItem>,
  dryRun: boolean,
): ApplyEditsResultSummary {
  const { updates, applied, skipped } = planAcceptedManuscriptEdits(manuscript, items);
  return { updates, applied, skipped, dryRun };
}

/**
 * Resolve a run from a project's history by id, or the most recent run when no id is given.
 * Pure helper shared by getHistory / getSupervisorStatus.
 */
export function selectRun(runs: PipelineRun[], runId?: string): PipelineRun | null {
  if (runId) return runs.find((r) => r.id === runId) ?? null;
  return runs[0] ?? null;
}

/** Extract per-stage supervisor decisions from a run (no AI — reads recorded decisions). */
export function supervisorStatusFromRun(run: PipelineRun): SupervisorStatusEntry[] {
  return run.stages.map((s) => ({
    stage: s.stage,
    supervisorDecision: s.supervisorDecision ?? null,
    status: s.status,
  }));
}

// ---------------------------------------------------------------------------
// Synthetic agent context (used by runStage in any runtime)
// ---------------------------------------------------------------------------

/** Config overrides where any property may be explicitly undefined (zod-inferred partials). */
export type PartialConfigOverrides = {
  [K in keyof PipelineConfig]?: PipelineConfig[K] | undefined;
};

/**
 * Merge a partial config onto the defaults, producing a complete PipelineConfig.
 * QNBS-v3: strips `undefined` values so a zod-inferred partial (exactOptionalPropertyTypes) never
 * clobbers a required default with `undefined`.
 */
export function resolveConfig(overrides?: PartialConfigOverrides): PipelineConfig {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v !== undefined) clean[k] = v;
  }
  return { ...DEFAULT_PIPELINE_CONFIG, ...clean } as PipelineConfig;
}

/**
 * Build a minimal OrchestratorContext for running a SINGLE agent programmatically (no Redux store).
 * Agents read `getState().project.present.data` (manuscript/title/logline/outline) and
 * `context.config`/`context.gateway`; dispatch is a no-op because single-stage runs do not mutate
 * Redux — the caller decides what to do with the returned review items.
 */
export function buildAgentContext(
  snapshot: ProForgeProjectSnapshot,
  config: PipelineConfig,
  gateway: ProForgeGatewayPort,
): OrchestratorContext {
  const syntheticState = {
    project: { present: { data: snapshot } },
    proForge: { currentRun: null },
    versionControl: { branches: [], currentBranchId: null },
  };
  return {
    // QNBS-v3: no-op dispatch — programmatic single-stage execution does not touch the store.
    dispatch: (() => undefined) as unknown as OrchestratorContext['dispatch'],
    getState: (() => syntheticState) as unknown as OrchestratorContext['getState'],
    projectId: snapshot.id,
    manuscript: snapshot.manuscript,
    characters: snapshot.characters,
    worlds: snapshot.worlds,
    config,
    gateway,
  };
}
