/**
 * Structural Agent — Phase 2: Developmental / Structural Correction
 * QNBS-v3: Macro-structure analysis: arcs, pacing, boundaries, reordering.
 */

import type {
  PipelineStage,
  ReviewItem,
  StageResult,
  StructuralEditPlan,
} from '../../../features/proForge/types';
import { aiProviderService } from '../../aiProviderService';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  stripJsonFences,
  structuralEditPlanSchema,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import { BaseAgent } from './baseAgent';

export class StructuralAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const memoryContext = await memoryBank.buildContextString('structural', undefined, 3000);

    // Get diagnostic report from memory
    const diagnosticEntries = await memoryBank.recall('meta');
    const diagnosticReport = diagnosticEntries.find((e) => e.key === 'diagnosticReport');

    // Build manuscript context (first 2 and last 2 sections + all titles)
    const sections = project.manuscript;
    const sectionList = sections
      .map((s, i) => `${i + 1}. ${s.title} (${s.content?.trim().split(/\s+/).length ?? 0} words)`)
      .join('\n');
    const fullExcerpt = sections
      .map((s) => `### ${s.title}\n${s.content?.substring(0, 600) ?? ''}`)
      .join('\n\n');

    const prompt = getPrompt('structuralEditPlan', {
      title: project.title,
      genre: config.genrePreset,
      language: config.language,
      sectionList,
      manuscriptExcerpt: fullExcerpt,
      diagnosticSummary: diagnosticReport?.content ?? 'No prior diagnostic available.',
      memoryContext,
    });

    let plan: StructuralEditPlan;
    let aiCalls = 0;
    let tokensConsumed = 0;

    // Word count for reflection gate
    const totalWords = sections.reduce(
      (acc, s) => acc + (s.content?.trim().split(/\s+/).length ?? 0),
      0,
    );

    try {
      const response = await aiProviderService.generateText(prompt, config.creativity, {
        maxOutputTokens: config.maxTokens,
      });
      aiCalls += 1;
      tokensConsumed += response.length;

      if (signal.aborted) throw new Error('Structural analysis aborted');

      plan = this.parseStructuralResponse(response) ?? this.createFallbackPlan(sections);

      // P-3: Self-evaluation loop — only for substantial manuscripts, never on fallbacks.
      if (totalWords > 500 && !plan.isFallback && !signal.aborted) {
        const reflection = await this.selfReflect(fullExcerpt, plan.summary, signal);
        aiCalls += 1;
        tokensConsumed += reflection.tokensUsed;

        if (!reflection.coherent && !signal.aborted) {
          logger.warn('StructuralAgent: Self-eval flagged INCOHERENT — retrying primary call');
          try {
            const retryRaw = await aiProviderService.generateText(prompt, config.creativity, {
              maxOutputTokens: config.maxTokens,
            });
            aiCalls += 1;
            tokensConsumed += retryRaw.length;
            const retried = this.parseStructuralResponse(retryRaw);
            if (retried) plan = retried;
          } catch (retryErr) {
            logger.warn('StructuralAgent: Self-eval retry failed:', retryErr);
          }
        }

        plan.reflectionNotes = reflection.note;
      }
    } catch (err) {
      logger.error('StructuralAgent: AI call failed:', err);
      plan = this.createFallbackPlan(sections);
    }

    // Save to memory bank
    await memoryBank.remember('edit', 'structuralPlan', JSON.stringify(plan), 'structural');

    // Convert to review items
    const reviewItems: ReviewItem[] = plan.edits.map((edit) => ({
      id: `struct-${edit.id}`,
      stage: 'structural' as PipelineStage,
      type: 'structuralEdit' as ReviewItem['type'],
      severity: edit.confidence > 0.85 ? 'warning' : 'info',
      sectionId: edit.sectionId,
      sectionTitle: edit.sectionTitle,
      range: edit.range,
      description: `[${edit.category.toUpperCase()}] ${edit.rationale}`,
      original: edit.original,
      proposed: edit.proposed,
      rationale: edit.rationale,
      confidence: edit.confidence,
      status: 'pending' as ReviewItem['status'],
      createdAt: new Date().toISOString(),
    }));

    // Add pacing report items
    for (const sp of plan.pacingReport.sectionPacing) {
      if (sp.recommendedAction && sp.recommendedAction !== 'keep') {
        reviewItems.push({
          id: `struct-pacing-${sp.sectionId}`,
          stage: 'structural',
          type: 'pacingIssue',
          severity: 'warning',
          sectionId: sp.sectionId,
          sectionTitle: sp.sectionTitle,
          description: `Pacing: ${sp.sectionTitle} has tension score ${sp.tensionScore}/10. Recommended: ${sp.recommendedAction}.`,
          suggestion: `${sp.recommendedAction === 'expand' ? 'Add tension, deepen scenes, or extend dialogue' : 'Compress exposition, tighten scenes, or remove redundant passages'}`,
          rationale: `Tension score ${sp.tensionScore}/10 indicates ${sp.recommendedAction} is needed`,
          confidence: 0.75,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      }
    }

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
      agentOutput: plan,
    };
  }

  private parseStructuralResponse(raw: string): StructuralEditPlan | null {
    const cleaned = stripJsonFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
    const validated = validateWithSchema(structuralEditPlanSchema, parsed);
    if (!validated.success) {
      logger.warn('StructuralAgent: Schema validation failed:', validated.error);
      return null;
    }
    return validated.data;
  }

  private createFallbackPlan(sections: Array<{ id: string; title: string }>): StructuralEditPlan {
    // QNBS-v3: isFallback=true so SupervisorAgent recognizes this as a failed run, not a clean manuscript.
    return {
      edits: [],
      isFallback: true,
      pacingReport: {
        sectionPacing: sections.map((s) => ({
          sectionId: s.id,
          sectionTitle: s.title,
          tensionScore: 0,
          wordCount: 0,
          recommendedAction: 'keep',
        })),
        overallPacing: 'moderate',
        suggestions: ['Structural analysis could not run. Check your AI provider and try again.'],
      },
      summary: 'Structural analysis could not run. Check your AI provider and try again.',
    };
  }
}
