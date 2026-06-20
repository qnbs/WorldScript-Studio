// QNBS-v3: Types for the ProForge XState machine (P4). The machine formalizes the 8-stage
// human-in-the-loop pipeline that proForgeOrchestrator.ts currently implements imperatively:
// per-stage snapshot → run agent → supervisor gate (retry/hard-fail) → human review → apply edits
// → advance, plus rollback and abort. The machine owns transient workflow state; Redux remains the
// persistent source of truth for the manuscript (wired via actors in the integration hook, P4b).
import type {
  PipelineStage,
  ReviewItem,
  ReviewItemStatus,
  StageMetrics,
  SupervisionDecision,
} from '../types';

// QNBS-v3: the pipeline only ever executes the real editing/production stages — 'idle' and 'archived'
// are run-lifecycle control states, never things an agent runs. Narrowing here stops an invalid
// control state from reaching runStage/supervise/rollback as if it were executable.
export type ExecutablePipelineStage = Exclude<PipelineStage, 'idle' | 'archived'>;

/** Minimal shape of a stage agent's output, mirroring what proForgeOrchestrator consumes. */
export interface StageAgentResult {
  reviewItems: ReviewItem[];
  metrics: StageMetrics;
  agentOutput?: unknown;
}

export interface ReviewDecision {
  itemId: string;
  status: ReviewItemStatus;
}

export interface ProForgeMachineInput {
  projectId: string;
  label: string;
  /** Ordered stages selected for this run (excludes 'idle'/'archived'). */
  selectedStages: ExecutablePipelineStage[];
  /**
   * Supervisor-triggered retries per stage. Optional — defaults to 1 (mirrors the orchestrator).
   * Constrained to `0 | 1` to match the pipeline config contract (PipelineRunConfig.maxRetries),
   * so an invalid retry policy can't pass type-checking and diverge at runtime.
   */
  maxRetries?: 0 | 1;
}

export interface ProForgeMachineContext {
  projectId: string;
  label: string;
  selectedStages: ExecutablePipelineStage[];
  /** Pointer into selectedStages. */
  stageIndex: number;
  currentStage: ExecutablePipelineStage;
  /** Retry counter for the current stage. */
  attempt: number;
  maxRetries: number;
  /** Supervisor rejection reasons fed into the next attempt's prompt. */
  retryFeedback: string;
  lastResult: StageAgentResult | null;
  lastDecision: SupervisionDecision | null;
  reviewDecisions: ReviewDecision[] | null;
  prePipelineSnapshotId: string | null;
  /** Per-stage snapshot ids keyed by stageIndex, captured before each stage runs, so ROLLBACK can
   * restore the target stage's checkpoint deterministically. */
  stageSnapshots: Record<number, string>;
  error: string | null;
}

export type ProForgeMachineEvent =
  | { type: 'START' }
  | { type: 'SUBMIT_REVIEW'; decisions: ReviewDecision[] }
  | { type: 'SKIP' }
  | { type: 'ROLLBACK'; stage: ExecutablePipelineStage }
  | { type: 'ABORT' };

/** Actor input/output contracts (implementations injected via .provide in the hook + tests). */
export interface RunStageInput {
  stage: ExecutablePipelineStage;
  retryFeedback: string;
}
export interface SuperviseInput {
  stage: ExecutablePipelineStage;
  result: StageAgentResult;
}
export interface SnapshotInput {
  stage: ExecutablePipelineStage | 'prePipeline';
  label: string;
}
export interface ApplyEditsInput {
  stage: ExecutablePipelineStage;
  decisions: ReviewDecision[];
  result: StageAgentResult | null;
}
