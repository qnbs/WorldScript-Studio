/**
 * ProForge Orchestrator — Central state machine for the 8-stage pipeline.
 * QNBS-v3: Coordinates agents, manages Human-in-the-Loop gates, handles rollback/abort.
 */

import type { AppDispatch, RootState } from '../../app/store';
import {
  pipelineAborted,
  pipelineCompleted,
  rollbackToStage,
  skipStage,
  stageCompleted,
  stageFailed,
  stageStarted,
  submitStageReview,
} from '../../features/proForge/proForgeSlice';
import type {
  PipelineConfig,
  PipelineStage,
  ReviewItemStatus,
  SupervisionDecision,
} from '../../features/proForge/types';
import { isEditingStage, nextStage } from '../../features/proForge/types';
import { logger } from '../logger';
import { planAcceptedManuscriptEdits } from './applyReviewEdits';
// QNBS-v3: stage→agent mapping extracted to a shared registry so the Core Capability Layer can run
// a single stage programmatically without duplicating it.
import { loadAgent } from './pipelineAgents/agentRegistry';

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorContext {
  dispatch: AppDispatch;
  getState: () => RootState;
  projectId: string;
  manuscript: Array<{ id: string; title: string; content: string }>;
  characters: Array<{ id: string; name: string }>;
  worlds: Array<{ id: string; name: string }>;
  config: PipelineConfig;
  // QNBS-v3: Optional injectable gateway — defaults to singleton if absent.
  // Allows tests to inject a mock without touching aiProviderService.
  gateway?: import('../ai/inferenceGateway').InferenceGateway;
}

export class ProForgeOrchestrator {
  // QNBS-v3: readonly (not private) — hook reads context.getState() to build a live state snapshot.
  readonly context: OrchestratorContext;
  private abortController = new AbortController();

  constructor(context: OrchestratorContext) {
    this.context = context;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** QNBS-v3: HEAD snapshot of the current branch — deduplicates the 4× inline lookup. */
  private headSnapshotId(): string | undefined {
    const vcState = this.context.getState().versionControl;
    return vcState.branches.find((b) => b.id === vcState.currentBranchId)?.headSnapshotId;
  }

  /** QNBS-v3: Best-effort persist of run history to IDB (survives reload). Never throws. */
  private async persistHistory(): Promise<void> {
    try {
      const runHistory = this.context.getState().proForge.runHistory;
      if (!runHistory?.length) return;
      const { saveRunHistory } = await import('./proForgeHistoryStore');
      await saveRunHistory(this.context.projectId, runHistory);
    } catch (err) {
      logger.warn('ProForge: failed to persist run history', err);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start a new pipeline run from the current state.
   * Creates a pre-pipeline snapshot automatically.
   */
  async startPipeline(label: string, config: PipelineConfig): Promise<void> {
    const { dispatch, getState, projectId } = this.context;
    // QNBS-v3: Reset the abort signal — the orchestrator instance is reused across runs
    // (cached in a hook ref); a prior abort would otherwise leave every agent pre-aborted.
    this.abortController = new AbortController();
    const state = getState();

    // Create pre-pipeline snapshot via version control
    const { versionControlActions } = await import(
      '../../features/versionControl/versionControlSlice'
    );
    const project = state.project.present?.data;
    if (!project) {
      throw new Error('No project data available');
    }

    const snapshotLabel = `Pre-ProForge: ${label}`;
    dispatch(
      versionControlActions.createSnapshot({
        label: snapshotLabel,
        sections: project.manuscript,
      }),
    );

    // Retrieve the snapshot ID (it's the last one created on current branch)
    const preSnapshotId = this.headSnapshotId() ?? 'unknown';

    dispatch(
      (await import('../../features/proForge/proForgeSlice')).startPipeline({
        projectId,
        label,
        config,
        preSnapshotId,
      }),
    );

    // Auto-start first stage if not idle
    const firstStage = config.selectedStages[0];
    if (firstStage && firstStage !== 'idle') {
      await this.executeStage(firstStage);
    }
  }

  /**
   * Execute a single pipeline stage.
   */
  async executeStage(stage: PipelineStage): Promise<void> {
    const { dispatch, getState } = this.context;
    const run = getState().proForge.currentRun;
    if (!run || run.status === 'aborted' || run.status === 'failed') {
      logger.warn('Orchestrator: Cannot execute stage, pipeline not active');
      return;
    }

    // Create pre-stage snapshot
    const { versionControlActions } = await import(
      '../../features/versionControl/versionControlSlice'
    );
    const project = getState().project.present?.data;
    if (project) {
      dispatch(
        versionControlActions.createSnapshot({
          label: `Pre-${stage}: ${run.label}`,
          sections: project.manuscript,
        }),
      );
    }
    const snapshotId = this.headSnapshotId();

    dispatch(stageStarted({ stage, ...(snapshotId !== undefined && { snapshotId }) }));

    const maxRetries = run.config.maxRetries ?? 1;
    await this.executeStageWithSupervision(stage, maxRetries);
  }

  /** Runs the agent then applies supervisor heuristics, retrying once if needed. */
  private async executeStageWithSupervision(
    stage: PipelineStage,
    maxRetries: number,
  ): Promise<void> {
    const { dispatch } = this.context;
    // QNBS-v3: Carries the prior attempt's rejection reasons into the next prompt.
    let retryFeedback = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const AgentClass = await loadAgent(stage);
        const agent = new AgentClass(this.context);
        if (retryFeedback) agent.setRetryFeedback(retryFeedback);
        const result = await agent.execute(this.abortController.signal);

        if (this.abortController.signal.aborted) {
          throw new Error('Stage aborted');
        }

        // QNBS-v3: Supervisor evaluates heuristic quality gates before advancing.
        const { SupervisorAgent } = await import('./pipelineAgents/supervisorAgent');
        const supervisor = new SupervisorAgent(this.context);
        const decision = supervisor.evaluate(stage, result);

        if (!decision.pass && attempt < maxRetries) {
          logger.warn(
            `SupervisorAgent: Stage ${stage} flagged (retry ${attempt + 1}):`,
            decision.reasons,
          );
          // QNBS-v3: Feed the supervisor's reasons + any self-reflection note into the retry.
          const reflectionNote = (result.agentOutput as { reflectionNotes?: string } | undefined)
            ?.reflectionNotes;
          retryFeedback = [...decision.reasons, reflectionNote]
            .filter((r): r is string => Boolean(r))
            .map((r) => `- ${r}`)
            .join('\n');
          continue;
        }

        // Hard gate: intake with qualityScore < 30 → fail with honest message.
        if (stage === 'intake' && decision.qualityScore < 30) {
          const message =
            "The diagnostic couldn't analyze your manuscript. Check your AI provider connection and try again.";
          dispatch(stageFailed({ stage, error: message }));
          return;
        }

        const supervisorDecision: SupervisionDecision | undefined = !decision.pass
          ? decision
          : undefined;

        dispatch(
          stageCompleted({
            stage,
            result: {
              reviewItems: result.reviewItems,
              metrics: result.metrics,
              agentOutput: result.agentOutput,
              ...(supervisorDecision !== undefined && { supervisorDecision }),
            },
          }),
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`ProForge stage ${stage} failed (attempt ${attempt + 1}):`, err);
        dispatch(stageFailed({ stage, error: message }));
        return;
      }
    }
  }

  /**
   * Advance to the next stage after review acceptance.
   */
  async advanceToNextStage(currentStage: PipelineStage): Promise<void> {
    const { dispatch, getState } = this.context;
    const run = getState().proForge.currentRun;
    if (!run) return;

    const next = nextStage(currentStage);
    if (!next || next === 'archived') {
      // Pipeline complete
      dispatch(pipelineCompleted());
      await this.persistHistory();
      return;
    }

    // Check if next stage is in selected stages
    if (!run.config.selectedStages.includes(next)) {
      // Skip and continue
      dispatch(skipStage({ stage: next }));
      await this.advanceToNextStage(next);
      return;
    }

    await this.executeStage(next);
  }

  /**
   * Submit review decisions for a stage and optionally advance.
   */
  async submitReview(
    stage: PipelineStage,
    decisions: Array<{ itemId: string; status: ReviewItemStatus }>,
    options?: { advance?: boolean },
  ): Promise<void> {
    const { dispatch, getState } = this.context;

    // QNBS-v3: Apply accepted edits to the manuscript BEFORE snapshotting, so the post-stage
    // snapshot captures the edited text. Only editing stages mutate prose; production/publishing/
    // analytics are advisory. Stale/unanchorable edits are skipped, never force-applied.
    if (isEditingStage(stage)) {
      const stageResult = getState().proForge.currentRun?.stages.find((s) => s.stage === stage);
      const project = getState().project.present?.data;
      if (stageResult && project) {
        const acceptedIds = new Set(
          decisions.filter((d) => d.status === 'accepted').map((d) => d.itemId),
        );
        const acceptedItems = stageResult.reviewItems.filter((ri) => acceptedIds.has(ri.id));
        const { updates, applied, skipped } = planAcceptedManuscriptEdits(
          project.manuscript,
          acceptedItems,
        );
        if (updates.length > 0) {
          const { projectActions } = await import('../../features/project/projectSlice');
          for (const update of updates) {
            dispatch(
              projectActions.updateManuscriptSection({
                id: update.id,
                changes: { content: update.content },
              }),
            );
          }
        }
        if (skipped > 0) {
          logger.warn(
            `ProForge submitReview: stage ${stage} applied ${applied} edit(s), skipped ${skipped} stale/unanchorable edit(s).`,
          );
        }
      }
    }

    // Create post-stage snapshot (now reflecting any applied edits).
    const project = getState().project.present?.data;
    if (project) {
      const { versionControlActions } = await import(
        '../../features/versionControl/versionControlSlice'
      );
      dispatch(
        versionControlActions.createSnapshot({
          label: `Post-${stage}: ${getState().proForge.currentRun?.label ?? 'Pipeline'}`,
          sections: project.manuscript,
        }),
      );
    }
    const postSnapshotId = this.headSnapshotId();

    dispatch(
      submitStageReview({
        stage,
        decisions,
        ...(postSnapshotId !== undefined && { postSnapshotId }),
      }),
    );

    if (options?.advance !== false) {
      await this.advanceToNextStage(stage);
    }
  }

  /**
   * Rollback to a previous stage, restoring the pre-stage snapshot.
   */
  async rollbackTo(stage: PipelineStage): Promise<void> {
    const { dispatch, getState } = this.context;
    const run = getState().proForge.currentRun;
    if (!run) return;

    const stageResult = run.stages.find((s) => s.stage === stage);
    if (stageResult?.preSnapshotId) {
      // Restore snapshot
      const { versionControlActions } = await import(
        '../../features/versionControl/versionControlSlice'
      );
      dispatch(
        versionControlActions.restoreSnapshot?.({
          snapshotId: stageResult.preSnapshotId,
        }) ?? { type: 'NOOP' },
      );
    }

    dispatch(rollbackToStage({ stage }));
  }

  /**
   * Abort the entire pipeline and restore pre-pipeline state.
   */
  async abortPipeline(): Promise<void> {
    const { dispatch, getState } = this.context;
    const run = getState().proForge.currentRun;
    if (!run) return;

    this.abortController.abort();

    // Restore pre-pipeline snapshot
    if (run.prePipelineSnapshotId) {
      const { versionControlActions } = await import(
        '../../features/versionControl/versionControlSlice'
      );
      dispatch(
        versionControlActions.restoreSnapshot?.({
          snapshotId: run.prePipelineSnapshotId,
        }) ?? { type: 'NOOP' },
      );
    }

    dispatch(pipelineAborted());
    await this.persistHistory();
  }

  /**
   * Skip a stage entirely.
   */
  skipStage(stage: PipelineStage): void {
    this.context.dispatch(skipStage({ stage }));
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.abortController.abort();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProForgeOrchestrator(context: OrchestratorContext): ProForgeOrchestrator {
  return new ProForgeOrchestrator(context);
}
