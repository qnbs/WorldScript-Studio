/**
 * SupervisorAgent — Heuristic quality gate between pipeline stages.
 * QNBS-v3: Detects fallback-report sentinels and structural red flags without AI calls.
 * Called by the orchestrator after each stage; never invoked as a pipeline stage itself.
 */

import type {
  CopyEditPlan,
  DiagnosticReport,
  PipelineAnalyticsReport,
  PipelineStage,
  ProductionManifest,
  PublishingPackage,
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
      case 'lineProse':
        return this.evaluateLineProse(result);
      case 'copyEdit':
        return this.evaluateCopyEdit(result);
      case 'proof':
        return this.evaluateProof(result);
      case 'production':
        return this.evaluateProduction(result);
      case 'publishing':
        return this.evaluatePublishing(result);
      case 'analytics':
        return this.evaluateAnalytics(result);
      default:
        return { pass: true, retryRecommended: false, qualityScore: 100, reasons: [] };
    }
  }

  private evaluateIntake(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as DiagnosticReport | undefined;
    const reasons: string[] = [];

    // QNBS-v3: Agents mark synthetic reports with isFallback:true + zeroed scores
    // (see createFallbackReport). The previous `=== 50` heuristic never matched.
    const isFallback = output?.isFallback === true;

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

    // QNBS-v3: Honour the explicit fallback marker before heuristics.
    if (output?.isFallback === true) {
      reasons.push('Structural analysis returned a fallback plan — the AI call did not complete.');
      return { pass: false, retryRecommended: true, qualityScore: 0, reasons };
    }

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

    // QNBS-v3: Honour the explicit fallback marker before heuristics.
    if (output?.isFallback === true) {
      reasons.push('Proof/quality gate returned a fallback report — the AI call did not complete.');
      return { pass: false, retryRecommended: true, qualityScore: 0, reasons };
    }

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

  private evaluateLineProse(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as { edits?: unknown[] } | undefined;
    const wordCount = this.estimateManuscriptWordCount();
    const hasEdits = (output?.edits?.length ?? 0) > 0;

    // QNBS-v3: A substantial manuscript with zero prose edits suggests the AI call didn't land.
    if (!hasEdits && result.reviewItems.length === 0 && wordCount > 1000) {
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: 45,
        reasons: [
          `No prose edits for a ${wordCount}-word manuscript — verify the AI provider responded.`,
        ],
      };
    }
    return { pass: true, retryRecommended: false, qualityScore: 85, reasons: [] };
  }

  private evaluateCopyEdit(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as CopyEditPlan | undefined;
    const total =
      (output?.grammarEdits?.length ?? 0) +
      (output?.styleEdits?.length ?? 0) +
      (output?.repetitionHits?.length ?? 0) +
      (output?.formatIssues?.length ?? 0);
    const wordCount = this.estimateManuscriptWordCount();

    // QNBS-v3: Zero grammar/style/repetition/format findings on a long manuscript is suspicious.
    if (total === 0 && result.reviewItems.length === 0 && wordCount > 1500) {
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: 50,
        reasons: [
          'Copy-edit found zero grammar/style/repetition issues on a long manuscript — verify the AI ran.',
        ],
      };
    }
    return { pass: true, retryRecommended: false, qualityScore: 88, reasons: [] };
  }

  private evaluateProduction(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as ProductionManifest | undefined;
    const artifactCount = output?.artifacts?.length ?? 0;

    // QNBS-v3: Production must emit at least one artifact; none means the build failed.
    if (artifactCount === 0) {
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: 0,
        reasons: ['Production produced no export artifacts.'],
      };
    }
    return { pass: true, retryRecommended: false, qualityScore: 95, reasons: [] };
  }

  private evaluatePublishing(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as PublishingPackage | undefined;
    const reasons: string[] = [];
    const hasTitle = (output?.metadata?.title ?? '').trim().length > 0;
    const hasBlurb = (output?.blurbs?.backCover ?? '').trim().length > 0;

    if (!hasTitle) reasons.push('Publishing package is missing book-title metadata.');
    if (!hasBlurb) reasons.push('Publishing package is missing a back-cover blurb.');
    if (reasons.length > 0) {
      return { pass: false, retryRecommended: true, qualityScore: 40, reasons };
    }
    return { pass: true, retryRecommended: false, qualityScore: 90, reasons: [] };
  }

  private evaluateAnalytics(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as PipelineAnalyticsReport | undefined;
    // QNBS-v3: Analytics is the terminal, informational stage — never block the pipeline on it,
    // but flag a missing metrics block so the trace records it.
    if (!output?.metrics) {
      return {
        pass: true,
        retryRecommended: false,
        qualityScore: 70,
        reasons: ['Analytics report has no metrics block (non-blocking).'],
      };
    }
    return { pass: true, retryRecommended: false, qualityScore: 100, reasons: [] };
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
