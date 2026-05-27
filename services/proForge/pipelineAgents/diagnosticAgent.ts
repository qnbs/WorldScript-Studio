/**
 * Diagnostic Agent — Phase 1: Intake & Diagnostic
 * QNBS-v3: Comprehensive manuscript analysis with structured report generation.
 */

import type {
  DiagnosticReport,
  PipelineStage,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { aiProviderService } from '../../aiProviderService';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  diagnosticReportSchema,
  stripJsonFences,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import type { ToolContext } from '../pipelineTools/toolRegistry';
import { BaseAgent } from './baseAgent';

export class DiagnosticAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { dispatch, getState, projectId, config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const _toolContext: ToolContext = {
      projectId,
      dispatch,
      getState,
      memoryBank,
      signal,
    };

    // Gather manuscript metadata
    const sections = project.manuscript;
    const totalWords = sections.reduce(
      (acc, s) => acc + (s.content?.trim().split(/\s+/).length ?? 0),
      0,
    );
    const avgSectionLength = sections.length > 0 ? Math.round(totalWords / sections.length) : 0;

    // Build tool context from memory bank
    const memoryContext = await memoryBank.buildContextString('intake', undefined, 3000);

    // Build the diagnostic prompt
    const manuscriptExcerpt = sections
      .slice(0, 3)
      .map((s) => `## ${s.title}\n${s.content?.substring(0, 800) ?? ''}`)
      .join('\n\n');

    const outlineText =
      project.outline?.map((o, i) => `${i + 1}. ${o.title}: ${o.description ?? ''}`).join('\n') ??
      '';

    const prompt = getPrompt('diagnosticReport', {
      title: project.title,
      logline: project.logline,
      genre: config.genrePreset,
      language: config.language,
      wordCount: String(totalWords),
      sectionCount: String(sections.length),
      avgSectionLength: String(avgSectionLength),
      outline: outlineText,
      manuscriptExcerpt,
      memoryContext,
    });

    // Call AI with structured output attempt
    let report: DiagnosticReport;
    let aiCalls = 0;
    let tokensConsumed = 0;

    try {
      const response = await aiProviderService.generateText(prompt, config.creativity, {
        maxOutputTokens: config.maxTokens,
      });
      aiCalls += 1;
      tokensConsumed += response.length; // rough estimate

      if (signal.aborted) throw new Error('Diagnostic aborted');

      report =
        this.parseDiagnosticResponse(response) ??
        this.createFallbackReport(project, totalWords, sections.length, avgSectionLength);

      // P-3: Self-evaluation loop — only for substantial manuscripts, never on fallbacks.
      if (totalWords > 500 && !report.isFallback && !signal.aborted) {
        const reflection = await this.selfReflect(manuscriptExcerpt, report.summary, signal);
        aiCalls += 1;
        tokensConsumed += reflection.tokensUsed;

        if (!reflection.coherent && !signal.aborted) {
          logger.warn('DiagnosticAgent: Self-eval flagged INCOHERENT — retrying primary call');
          try {
            const retryRaw = await aiProviderService.generateText(prompt, config.creativity, {
              maxOutputTokens: config.maxTokens,
            });
            aiCalls += 1;
            tokensConsumed += retryRaw.length;
            const retried = this.parseDiagnosticResponse(retryRaw);
            if (retried) report = retried;
          } catch (retryErr) {
            logger.warn('DiagnosticAgent: Self-eval retry failed:', retryErr);
          }
        }

        report.reflectionNotes = reflection.note;
      }
    } catch (err) {
      logger.error('DiagnosticAgent: AI call failed:', err);
      report = this.createFallbackReport(project, totalWords, sections.length, avgSectionLength);
    }

    // Save report to memory bank
    await memoryBank.remember('meta', 'diagnosticReport', JSON.stringify(report), 'intake');

    // Convert report issues to review items
    const reviewItems: ReviewItem[] = [
      ...report.consistencyIssues.map((issue) => ({
        id: `diag-consistency-${issue.id}`,
        stage: 'intake' as PipelineStage,
        type: 'consistencyIssue' as ReviewItem['type'],
        severity: issue.severity,
        sectionIds: issue.sectionIds,
        description: `[${issue.type.toUpperCase()}] ${issue.entityName ? `(${issue.entityName}) ` : ''}${issue.description}`,
        rationale: 'Identified during diagnostic analysis',
        confidence: issue.severity === 'critical' ? 0.9 : 0.75,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
      ...report.structuralGaps.map((gap) => ({
        id: `diag-structural-${gap.id}`,
        stage: 'intake' as PipelineStage,
        type: 'plotHole' as ReviewItem['type'],
        severity: 'warning' as ReviewItem['severity'],
        sectionIds: gap.affectedSectionIds,
        description: `[${gap.type}] ${gap.description}`,
        suggestion: gap.suggestion,
        rationale: 'Structural gap identified during diagnostic analysis',
        confidence: 0.8,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
    ];

    // Add quality score as info item
    reviewItems.push({
      id: 'diag-quality-score',
      stage: 'intake',
      type: 'consistencyIssue',
      severity: 'info',
      description: `Quality Score: ${report.qualityScore.overall}/100 (Prose: ${report.qualityScore.prose}, Structure: ${report.qualityScore.structure}, Consistency: ${report.qualityScore.consistency}, Pacing: ${report.qualityScore.pacing}, Dialogue: ${report.qualityScore.dialogue}, Marketability: ${report.qualityScore.marketability})`,
      rationale: report.summary,
      confidence: 0.85,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const durationMs = this.elapsed(startTime);

    return {
      reviewItems,
      metrics: {
        aiCalls,
        tokensConsumed,
        durationMs,
        itemsFound: reviewItems.length,
        itemsAccepted: 0,
        itemsRejected: 0,
      },
      agentOutput: report,
    };
  }

  private parseDiagnosticResponse(raw: string): DiagnosticReport | null {
    const cleaned = stripJsonFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
    const validated = validateWithSchema(diagnosticReportSchema, parsed);
    if (!validated.success) {
      logger.warn('DiagnosticAgent: Schema validation failed:', validated.error);
      return null;
    }
    return validated.data;
  }

  private createFallbackReport(
    project: { title: string; logline: string },
    wordCount: number,
    sectionCount: number,
    avgSectionLength: number,
  ): DiagnosticReport {
    // QNBS-v3: isFallback=true marks scores as synthetic so SupervisorAgent can detect them.
    // Scores are 0 (not 50) to be honest — the pipeline did not actually run this analysis.
    return {
      profile: {
        wordCount,
        sectionCount,
        averageSectionLength: avgSectionLength,
        detectedGenre: 'unknown',
        pacingEstimate: 'moderate',
      },
      consistencyIssues: [],
      structuralGaps: [],
      qualityScore: {
        overall: 0,
        prose: 0,
        structure: 0,
        consistency: 0,
        pacing: 0,
        dialogue: 0,
        marketability: 0,
      },
      isFallback: true,
      summary: `Diagnostic could not complete for "${project.title}". Please check your AI provider connection and try again.`,
    };
  }
}
