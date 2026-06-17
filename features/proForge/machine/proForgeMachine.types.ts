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
  selectedStages: PipelineStage[];
  /** Supervisor-triggered retries per stage (0 or 1). */
  maxRetries: number;
}

export interface ProForgeMachineContext {
  projectId: string;
  label: string;
  selectedStages: PipelineStage[];
  /** Pointer into selectedStages. */
  stageIndex: number;
  currentStage: PipelineStage;
  /** Retry counter for the current stage. */
  attempt: number;
  maxRetries: number;
  /** Supervisor rejection reasons fed into the next attempt's prompt. */
  retryFeedback: string;
  lastResult: StageAgentResult | null;
  lastDecision: SupervisionDecision | null;
  reviewDecisions: ReviewDecision[] | null;
  prePipelineSnapshotId: string | null;
  error: string | null;
}

export type ProForgeMachineEvent =
  | { type: 'START' }
  | { type: 'SUBMIT_REVIEW'; decisions: ReviewDecision[] }
  | { type: 'SKIP' }
  | { type: 'ROLLBACK'; stage: PipelineStage }
  | { type: 'ABORT' };

/** Actor input/output contracts (implementations injected via .provide in the hook + tests). */
export interface RunStageInput {
  stage: PipelineStage;
  retryFeedback: string;
}
export interface SuperviseInput {
  stage: PipelineStage;
  result: StageAgentResult;
}
export interface SnapshotInput {
  stage: PipelineStage | 'prePipeline';
  label: string;
}
export interface ApplyEditsInput {
  stage: PipelineStage;
  decisions: ReviewDecision[];
  result: StageAgentResult | null;
}
