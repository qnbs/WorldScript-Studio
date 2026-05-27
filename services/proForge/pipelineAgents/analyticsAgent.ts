/**
 * Analytics Agent — Phase 8: Analytics, Iteration & Archive
 * QNBS-v3: Metrics aggregation, lessons learned, archive preparation.
 */

import type {
  PipelineAnalyticsReport,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { BaseAgent } from './baseAgent';

export class AnalyticsAgent extends BaseAgent {
  async execute(
    _signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { getState } = this.context;
    const state = getState();
    const run = state.proForge.currentRun;
    if (!run) throw new Error('No active pipeline run');

    const memoryBank = this.getMemoryBank();

    // Aggregate metrics from all completed stages
    const totalAiCalls = run.stages.reduce((acc, s) => acc + s.metrics.aiCalls, 0);
    const totalTokens = run.stages.reduce((acc, s) => acc + s.metrics.tokensConsumed, 0);
    const totalDuration = run.stages.reduce((acc, s) => acc + s.metrics.durationMs, 0);
    const totalEditsFound = run.stages.reduce((acc, s) => acc + s.metrics.itemsFound, 0);
    const totalEditsAccepted = run.stages.reduce((acc, s) => acc + s.metrics.itemsAccepted, 0);
    const totalEditsRejected = run.stages.reduce((acc, s) => acc + s.metrics.itemsRejected, 0);

    const stageDurations: Record<string, number> = {};
    for (const stage of run.stages) {
      stageDurations[stage.stage] = stage.metrics.durationMs;
    }

    // Calculate quality improvement (rough estimate from diagnostic score)
    const diagnosticStage = run.stages.find((s) => s.stage === 'intake');
    const diagnosticOutput = diagnosticStage?.agentOutput as
      | { qualityScore?: { overall: number } }
      | undefined;
    const _initialScore = diagnosticOutput?.qualityScore?.overall ?? 50;
    const qualityImprovement = Math.min(30, totalEditsAccepted * 0.5); // heuristic

    const report: PipelineAnalyticsReport = {
      runId: run.id,
      metrics: {
        totalDurationMs: totalDuration,
        totalAiCalls: totalAiCalls,
        totalTokensConsumed: totalTokens,
        stageDurations,
        totalEditsFound,
        totalEditsAccepted,
        totalEditsRejected,
        qualityImprovement,
      },
      lessonsLearned: {
        whatWorked: [
          `Pipeline completed with ${totalEditsAccepted} accepted improvements`,
          totalTokens > 0
            ? `AI-assisted analysis consumed ~${totalTokens} tokens`
            : 'Offline heuristic analysis used',
        ],
        whatDidntWork:
          totalEditsRejected > 0
            ? [
                `${totalEditsRejected} suggestions were rejected — consider adjusting genre preset or style guide`,
              ]
            : [],
        recommendations: [
          'Review rejected suggestions for patterns that could inform future writing',
          'Compare quality scores across pipeline runs to track improvement over time',
        ],
        authorNotes: '',
      },
      comparisonToPreviousRuns: state.proForge.runHistory.slice(0, 5).map((h) => ({
        runId: h.id,
        runLabel: h.label,
        qualityImprovement: 0, // Would need stored scores
        durationMs: h.stages.reduce((acc, s) => acc + s.metrics.durationMs, 0),
      })),
    };

    await memoryBank.remember('meta', 'analyticsReport', JSON.stringify(report), 'analytics');

    const reviewItems: ReviewItem[] = [
      {
        id: 'analytics-summary',
        stage: 'analytics',
        type: 'consistencyIssue',
        severity: 'info',
        description: `Pipeline Analytics: ${totalEditsAccepted} edits accepted, ${totalEditsRejected} rejected. Duration: ${(totalDuration / 1000).toFixed(1)}s. Quality improvement: +${qualityImprovement.toFixed(1)} points.`,
        rationale: 'Pipeline analytics and metrics summary',
        confidence: 1.0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    const durationMs = this.elapsed(startTime);

    return {
      reviewItems,
      metrics: {
        aiCalls: 0,
        tokensConsumed: 0,
        durationMs,
        itemsFound: reviewItems.length,
        itemsAccepted: 0,
        itemsRejected: 0,
      },
      agentOutput: report,
    };
  }
}
