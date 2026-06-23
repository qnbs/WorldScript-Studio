/**
 * Pure pipeline-progress derivation for the ProForge dashboard.
 * QNBS-v3: PR7 — a determinate "stage N of M" / percent signal derived from the run's selected
 * stages and their statuses. No side effects; safe to call in render and in tests.
 */

import type { PipelineRun, PipelineStage, StageStatus } from './types';

export interface PipelineProgress {
  /** Stages whose work is done (accepted or skipped). */
  completed: number;
  /** Total selected stages for this run. */
  total: number;
  /** Completion percentage, 0–100 (integer). */
  percent: number;
  /** 1-based position of the active stage within the selected stages (0 if not found). */
  activeIndex: number;
}

// A stage counts as "done" once it has advanced past review (accepted) or been skipped.
const DONE_STATUSES: ReadonlySet<StageStatus> = new Set<StageStatus>(['accepted', 'skipped']);

/**
 * Derive determinate progress for a run. Returns a zeroed result when there is no run or no
 * selected stages, so callers can render unconditionally.
 */
export function computePipelineProgress(run: PipelineRun | null | undefined): PipelineProgress {
  const selected: PipelineStage[] = run?.config.selectedStages ?? [];
  const total = selected.length;
  if (!run || total === 0) {
    return { completed: 0, total: 0, percent: 0, activeIndex: 0 };
  }

  // Index stage statuses for O(1) lookup; only selected stages count toward the total.
  const statusByStage = new Map<PipelineStage, StageStatus>(
    run.stages.map((s) => [s.stage, s.status]),
  );
  const completed = selected.reduce((acc, stage) => {
    const status = statusByStage.get(stage);
    return status !== undefined && DONE_STATUSES.has(status) ? acc + 1 : acc;
  }, 0);

  const activeIndex = selected.indexOf(run.activeStage) + 1;
  const percent = Math.round((completed / total) * 100);

  return { completed, total, percent, activeIndex };
}
