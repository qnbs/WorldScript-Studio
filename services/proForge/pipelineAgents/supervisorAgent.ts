/**
 * SupervisorAgent — Heuristic quality gate between pipeline stages.
 * QNBS-v3: Detects fallback-report sentinels and structural red flags without AI calls.
 * Called by the orchestrator after each stage; never invoked as a pipeline stage itself.
 */

import type {
  DiagnosticReport,
  PipelineStage,
  QualityGateReport,
  StageResult,
  StructuralEditPlan,
  SupervisionDecision,
} from '../../../features/proForge/types';
import type { OrchestratorContext } from '../proForgeOrchestrator';

export class SupervisorAgent {
  private readonly context: OrchestratorContext;

  constructor(context: OrchestratorContext) {
    this.context = context;
  }

  evaluate(
    stage: PipelineStage,
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    switch (stage) {
      case 'intake':
        return this.evaluateIntake(result);
      case 'structural':
        return this.evaluateStructural(result);
      case 'proof':
        return this.evaluateProof(result);
      default:
        return { pass: true, retryRecommended: false, qualityScore: 100, reasons: [] };
    }
  }

  private evaluateIntake(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as DiagnosticReport | undefined;
    const reasons: string[] = [];

    // QNBS-v3: qualityScore.overall===50 across all 6 dimensions is the fallback sentinel.
    const isFallback =
      output?.qualityScore !== undefined &&
      output.qualityScore.overall === 50 &&
      output.qualityScore.prose === 50 &&
      output.qualityScore.structure === 50;

    if (isFallback) {
      reasons.push(
        'Diagnostic returned uniform 50/100 scores — likely a fallback, not real analysis.',
      );
    }

    const hasIssues =
      (output?.consistencyIssues?.length ?? 0) + (output?.structuralGaps?.length ?? 0) > 0;
    if (!hasIssues && !isFallback) {
      reasons.push('No issues found — verify AI provider is connected and manuscript has content.');
    }

    const qualityScore = isFallback ? 0 : (output?.qualityScore?.overall ?? 50);
    return {
      pass: !isFallback,
      retryRecommended: isFallback,
      qualityScore,
      reasons,
    };
  }

  private evaluateStructural(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as StructuralEditPlan | undefined;
    const reasons: string[] = [];

    const wordCount = this.estimateManuscriptWordCount();
    const hasEdits = (output?.edits?.length ?? 0) > 0;
    const hasReviewItems = result.reviewItems.length > 0;

    // QNBS-v3: A manuscript over 1000 words with zero structural edits is suspicious.
    if (!hasEdits && !hasReviewItems && wordCount > 1000) {
      reasons.push(
        `No structural edits found for a ${wordCount}-word manuscript — may need human review.`,
      );
      return { pass: false, retryRecommended: true, qualityScore: 40, reasons };
    }

    return { pass: true, retryRecommended: false, qualityScore: 80, reasons };
  }

  private evaluateProof(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as QualityGateReport | undefined;
    const reasons: string[] = [];

    const wordCount = this.estimateManuscriptWordCount();
    const seemsFallback =
      output?.overallPass === true &&
      (output.grammar?.issues?.length ?? 0) === 0 &&
      wordCount > 500;

    if (seemsFallback) {
      reasons.push(
        'Proof passed with zero grammar issues on a substantial manuscript — verify AI ran correctly.',
      );
      return { pass: false, retryRecommended: true, qualityScore: 40, reasons };
    }

    return { pass: true, retryRecommended: false, qualityScore: 90, reasons };
  }

  private estimateManuscriptWordCount(): number {
    const project = this.context.getState().project.present?.data;
    if (!project) return 0;
    return project.manuscript.reduce(
      (acc, s) => acc + (s.content?.trim().split(/\s+/).length ?? 0),
      0,
    );
  }
}
