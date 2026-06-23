/**
 * SupervisorAgent — Heuristic quality gate between pipeline stages.
 * QNBS-v3: Detects fallback-report sentinels and structural red flags without AI calls.
 * Called by the orchestrator after each stage; never invoked as a pipeline stage itself.
 */

import {
  type CopyEditPlan,
  DEFAULT_QUALITY_THRESHOLDS,
  type DiagnosticReport,
  type PipelineAnalyticsReport,
  type PipelineStage,
  type ProductionManifest,
  type PublishingPackage,
  type QualityGateReport,
  type QualityThresholds,
  type StageResult,
  type StructuralEditPlan,
  type SupervisionDecision,
} from '../../../features/proForge/types';
import type { OrchestratorContext } from '../proForgeOrchestrator';

export class SupervisorAgent {
  private readonly context: OrchestratorContext;
  private readonly thresholds: QualityThresholds;

  constructor(context: OrchestratorContext, thresholds?: Partial<QualityThresholds>) {
    this.context = context;
    this.thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...thresholds };
  }

  /**
   * QNBS-v3: PR6 — a *measured* confidence score instead of a flat constant. It scales with how much
   * real signal the stage produced relative to manuscript size (findings per ~1000 words), within a
   * pass band, so the score actually varies with the work done rather than always reporting the same
   * number. The supervisor still does NO AI calls — this is a heuristic confidence, not editorial
   * quality.
   */
  private confidenceScore(findings: number, wordCount: number, floor = 60, ceil = 95): number {
    if (wordCount <= 0) return Math.round((floor + ceil) / 2);
    const perThousand = findings / Math.max(1, wordCount / 1000);
    return Math.round(Math.min(ceil, floor + perThousand * 9));
  }

  /** A measured "this looks like a fallback" score: the larger the manuscript, the more suspicious. */
  private suspectScore(wordCount: number): number {
    return Math.max(20, 50 - Math.floor(wordCount / 500));
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

  /**
   * QNBS-v3: PR6 — centralized intake hard gate, shared by the orchestrator and the capability
   * layer so every entry point enforces identical rules. Fires ONLY when the supervisor actually
   * flagged intake as failed (fallback / no real analysis) AND the measured score is below the
   * configured floor — never on a low-but-genuine score alone, which would mislabel a legitimately
   * weak manuscript as an AI-provider failure.
   */
  intakeHardGateFailed(decision: SupervisionDecision): boolean {
    return !decision.pass && decision.qualityScore < this.thresholds.intakeHardGate;
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
    const editCount = output?.edits?.length ?? 0;
    // QNBS-v3: reviewItems are derived 1:1 from these same edits (StructuralAgent maps plan.edits
    // into reviewItems), so the canonical signal is the max of the two — summing would double-count
    // and inflate the measured confidence.
    const signal = Math.max(editCount, result.reviewItems.length);

    // QNBS-v3: A large manuscript with zero structural edits is suspicious (likely a fallback).
    if (signal === 0 && wordCount > this.thresholds.largeManuscriptWords) {
      reasons.push(
        `No structural edits found for a ${wordCount}-word manuscript — may need human review.`,
      );
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: this.suspectScore(wordCount),
        reasons,
      };
    }

    return {
      pass: true,
      retryRecommended: false,
      qualityScore: this.confidenceScore(signal, wordCount),
      reasons,
    };
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
    // QNBS-v3: count ALL proof-stage signal (grammar + style + technical + legal), not just grammar
    // — a report with substantial non-grammar findings was previously scored as if it found nothing.
    const proofFindings =
      (output?.grammar?.issues?.length ?? 0) +
      (output?.style?.issues?.length ?? 0) +
      (output?.technical?.issues?.length ?? 0) +
      (output?.legal?.warnings?.length ?? 0);
    // Proof is more sensitive than structural edits — half the large-manuscript threshold.
    const proofThreshold = Math.round(this.thresholds.largeManuscriptWords / 2);
    const seemsFallback =
      output?.overallPass === true && proofFindings === 0 && wordCount > proofThreshold;

    if (seemsFallback) {
      reasons.push(
        'Proof passed with zero issues across grammar/style/technical/legal on a substantial manuscript — verify AI ran correctly.',
      );
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: this.suspectScore(wordCount),
        reasons,
      };
    }

    return {
      pass: true,
      retryRecommended: false,
      qualityScore: this.confidenceScore(proofFindings, wordCount, 70, 95),
      reasons,
    };
  }

  private evaluateLineProse(
    result: Pick<StageResult, 'reviewItems' | 'agentOutput'>,
  ): SupervisionDecision {
    const output = result.agentOutput as { edits?: unknown[] } | undefined;
    const wordCount = this.estimateManuscriptWordCount();
    // QNBS-v3: ProseAgent builds reviewItems directly from output.edits, so take the canonical count
    // (max), not the sum — summing double-counts and overstates line-prose confidence.
    const signal = Math.max(output?.edits?.length ?? 0, result.reviewItems.length);

    // QNBS-v3: A substantial manuscript with zero prose edits suggests the AI call didn't land.
    if (signal === 0 && wordCount > this.thresholds.largeManuscriptWords) {
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: this.suspectScore(wordCount),
        reasons: [
          `No prose edits for a ${wordCount}-word manuscript — verify the AI provider responded.`,
        ],
      };
    }
    return {
      pass: true,
      retryRecommended: false,
      qualityScore: this.confidenceScore(signal, wordCount),
      reasons: [],
    };
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
    // QNBS-v3: reviewItems are generated from these same grammar/style/repetition/format findings,
    // so take the canonical count (max), not the sum — summing double-counts confidence.
    const signal = Math.max(total, result.reviewItems.length);
    // Copy-edit is the least sensitive editing stage — 1.5× the large-manuscript threshold.
    const copyEditThreshold = Math.round(this.thresholds.largeManuscriptWords * 1.5);

    // QNBS-v3: Zero grammar/style/repetition/format findings on a long manuscript is suspicious.
    if (signal === 0 && wordCount > copyEditThreshold) {
      return {
        pass: false,
        retryRecommended: true,
        qualityScore: this.suspectScore(wordCount),
        reasons: [
          'Copy-edit found zero grammar/style/repetition issues on a long manuscript — verify the AI ran.',
        ],
      };
    }
    return {
      pass: true,
      retryRecommended: false,
      qualityScore: this.confidenceScore(signal, wordCount),
      reasons: [],
    };
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
