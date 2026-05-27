/**
 * Proof Agent — Phase 5: Proofreading & Final Quality Gate
 * QNBS-v3: Final error sweep, legal scan, readability, format validation.
 */

import type {
  PipelineStage,
  QualityGateReport,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { aiProviderService } from '../../aiProviderService';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  qualityGateReportSchema,
  stripJsonFences,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import { BaseAgent } from './baseAgent';

export class ProofAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const memoryContext = await memoryBank.buildContextString('proof', undefined, 2000);

    // Build full manuscript text (truncated for token limits)
    const sections = project.manuscript;
    const fullText = sections.map((s) => `### ${s.title}\n${s.content ?? ''}`).join('\n\n');
    const truncatedText = fullText.substring(0, 12000);

    const prompt = getPrompt('qualityGateReport', {
      title: project.title,
      genre: config.genrePreset,
      language: config.language,
      manuscript: truncatedText,
      memoryContext,
    });

    let report: QualityGateReport;
    let aiCalls = 0;
    let tokensConsumed = 0;

    try {
      const response = await aiProviderService.generateText(prompt, 'Focused', {
        maxOutputTokens: Math.min(config.maxTokens, 4000),
      });
      aiCalls += 1;
      tokensConsumed += response.length;

      if (signal.aborted) throw new Error('Proofreading aborted');

      const cleaned = stripJsonFences(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      }

      const validated = validateWithSchema(qualityGateReportSchema, parsed);
      if (!validated.success) {
        logger.warn('ProofAgent: Schema validation failed:', validated.error);
        report = this.createFallbackReport();
      } else {
        report = validated.data;
      }
    } catch (err) {
      logger.error('ProofAgent: AI call failed:', err);
      report = this.createFallbackReport();
    }

    await memoryBank.remember('feedback', 'qualityGate', JSON.stringify(report), 'proof');

    const reviewItems: ReviewItem[] = [
      ...report.grammar.issues.map((issue, i) => ({
        id: `proof-g-${i}`,
        stage: 'proof' as PipelineStage,
        type: 'grammarEdit' as ReviewItem['type'],
        severity: 'warning' as ReviewItem['severity'],
        sectionId: issue.sectionId,
        range:
          issue.startOffset !== undefined && issue.endOffset !== undefined
            ? { start: issue.startOffset, end: issue.endOffset }
            : undefined,
        description: `[Grammar] ${issue.explanation ?? issue.issue}`,
        original: issue.original,
        proposed: issue.proposed,
        rationale: issue.explanation ?? 'Grammar issue',
        confidence: 0.9,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
      ...report.legal.warnings.map((w) => ({
        id: `proof-l-${w.id}`,
        stage: 'proof' as PipelineStage,
        type: 'legalWarning' as ReviewItem['type'],
        severity: w.severity as ReviewItem['severity'],
        sectionId: w.sectionId,
        description: `[LEGAL: ${w.type.toUpperCase()}] ${w.description}`,
        original: w.affectedText,
        proposed: w.recommendation,
        rationale: w.recommendation,
        confidence: 0.95,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
      ...report.technical.issues.map((issue, i) => ({
        id: `proof-t-${i}`,
        stage: 'proof' as PipelineStage,
        type: 'technicalIssue' as ReviewItem['type'],
        severity: 'info' as ReviewItem['severity'],
        description: `[Technical] ${issue.issue}`,
        rationale: 'Technical validation issue',
        confidence: 0.8,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
    ];

    // Add overall pass/fail as info item
    reviewItems.unshift({
      id: 'proof-overall',
      stage: 'proof',
      type: 'consistencyIssue',
      severity: report.overallPass ? 'info' : 'critical',
      description: `Quality Gate: ${report.overallPass ? 'PASSED' : 'FAILED'} | Grammar: ${report.grammar.score}/100 | Style: ${report.style.score}/100 | Technical: ${report.technical.score}/100 | Legal: ${report.legal.score}/100 | Readability: ${report.readability.score}/100`,
      rationale: report.summary,
      confidence: 1.0,
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

  private createFallbackReport(): QualityGateReport {
    // QNBS-v3: isFallback=true + overallPass=false prevents silently advancing past a broken proof stage.
    return {
      overallPass: false,
      isFallback: true,
      grammar: { pass: false, score: 0, issues: [] },
      style: { pass: false, score: 0, issues: [] },
      technical: { pass: false, score: 0, issues: [] },
      legal: { pass: false, score: 0, warnings: [] },
      readability: {
        pass: false,
        score: 0,
        metrics: {
          fleschKincaid: 0,
          fleschReadingEase: 0,
          targetAgeMin: 0,
          targetAgeMax: 0,
          appropriateForGenre: false,
        },
      },
      summary: 'Quality gate could not run. Check your AI provider connection and try again.',
    };
  }
}
