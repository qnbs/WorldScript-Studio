/**
 * CopyEdit Agent — Phase 4: Copy Editing & Language Polish
 * QNBS-v3: Grammar, style, repetition, register, formatting consistency.
 */

import type {
  CopyEditPlan,
  PipelineStage,
  RepetitionHit,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  copyEditPlanSchema,
  stripJsonFences,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import { BaseAgent } from './baseAgent';

export class CopyEditAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const memoryContext = await this.gatherMemoryContext('copyEdit', 2000);

    const sections = project.manuscript;
    // Process up to 3 sections for MVP
    const sectionsToProcess = sections.slice(0, 3);

    const allGrammarEdits: CopyEditPlan['grammarEdits'] = [];
    const allStyleEdits: CopyEditPlan['styleEdits'] = [];
    const allRepetitionHits: CopyEditPlan['repetitionHits'] = [];
    const allFormatIssues: CopyEditPlan['formatIssues'] = [];

    let aiCalls = 0;
    let tokensConsumed = 0;

    for (const section of sectionsToProcess) {
      if (signal.aborted) break;
      // QNBS-v3: PR7 — yield between sections so the UI stays responsive during synchronous
      // post-AI processing (validation, dedup) on large manuscripts.
      await this.cooperativeYield();
      // QNBS-v3: PR7 — re-check after the async yield: an abort during the yield must not let one
      // more section (and its AI call) slip through.
      if (signal.aborted) break;
      const content = section.content ?? '';
      if (content.trim().split(/\s+/).length < 50) continue;

      const prompt = getPrompt('copyEditPlan', {
        sectionTitle: section.title,
        sectionContent: content,
        genre: config.genrePreset,
        language: config.language,
        styleGuide: config.styleGuide ?? 'Standard',
        memoryContext,
      });

      try {
        const response = await this.generate(prompt, Math.min(config.maxTokens, 4000));
        aiCalls += 1;
        tokensConsumed += response.length;

        const cleaned = stripJsonFences(response);
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        }

        const validated = validateWithSchema(copyEditPlanSchema, parsed);
        if (validated.success) {
          allGrammarEdits.push(
            ...validated.data.grammarEdits.map((e) => ({ ...e, sectionId: section.id })),
          );
          allStyleEdits.push(
            ...validated.data.styleEdits.map((e) => ({ ...e, sectionId: section.id })),
          );
          allFormatIssues.push(
            ...validated.data.formatIssues.map((e) => ({ ...e, sectionId: section.id })),
          );
          allRepetitionHits.push(
            ...validated.data.repetitionHits.map(
              (h): RepetitionHit => ({
                id: h.id,
                wordOrPhrase: h.wordOrPhrase,
                occurrences: h.occurrences,
                count: h.count,
                ...(h.suggestion !== undefined && { suggestion: h.suggestion }),
              }),
            ),
          );
        }
      } catch (err) {
        logger.warn(`CopyEditAgent: Failed section ${section.id}:`, err);
      }
    }

    // QNBS-v3: PR7 — stop promptly on abort BEFORE the expensive post-loop work (repetition scan,
    // dedup, memory write, result assembly). Throwing (rather than returning an empty result) makes
    // cancellation EXPLICIT, so the capability-layer path can't mistake an aborted run for a
    // successful empty completion. The orchestrator catches this the same as its own abort guard.
    if (signal.aborted) throw new Error('Stage aborted');

    // Client-side repetition detection
    const clientRepetitions = this.detectRepetitions(sections);
    allRepetitionHits.push(...clientRepetitions);

    // Deduplicate
    const uniqueGrammar = this.deduplicateByRange(allGrammarEdits);
    const uniqueStyle = this.deduplicateByRange(allStyleEdits);

    const plan: CopyEditPlan = {
      grammarEdits: uniqueGrammar,
      styleEdits: uniqueStyle,
      repetitionHits: allRepetitionHits.slice(0, 20),
      formatIssues: allFormatIssues.slice(0, 20),
      summary: `Copy edit complete. ${uniqueGrammar.length} grammar, ${uniqueStyle.length} style, ${allRepetitionHits.length} repetition issues found.`,
    };

    await memoryBank.remember('edit', 'copyEditPlan', JSON.stringify(plan), 'copyEdit');

    const reviewItems: ReviewItem[] = [
      ...uniqueGrammar.map((edit) => ({
        id: `copy-g-${edit.id}`,
        stage: 'copyEdit' as PipelineStage,
        type: 'grammarEdit' as ReviewItem['type'],
        severity: 'warning' as ReviewItem['severity'],
        sectionId: edit.sectionId,
        range: { start: edit.startOffset, end: edit.endOffset },
        description: `[${edit.ruleName}] ${edit.explanation}`,
        original: edit.original,
        proposed: edit.proposed,
        rationale: edit.explanation,
        confidence: 0.85,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
      ...uniqueStyle.map((edit) => ({
        id: `copy-s-${edit.id}`,
        stage: 'copyEdit' as PipelineStage,
        type: 'styleEdit' as ReviewItem['type'],
        severity: 'info' as ReviewItem['severity'],
        sectionId: edit.sectionId,
        range: { start: edit.startOffset, end: edit.endOffset },
        description: `[${edit.category}] ${edit.rationale}`,
        original: edit.original,
        proposed: edit.proposed,
        rationale: edit.rationale,
        confidence: 0.8,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
      ...allRepetitionHits.slice(0, 10).map((hit) => ({
        id: `copy-r-${hit.id}`,
        stage: 'copyEdit' as PipelineStage,
        type: 'repetitionHit' as ReviewItem['type'],
        severity: 'info' as ReviewItem['severity'],
        description: `Repetition: "${hit.wordOrPhrase}" appears ${hit.count} times. ${hit.suggestion ?? ''}`,
        ...(hit.suggestion !== undefined && { suggestion: hit.suggestion }),
        rationale: 'Repeated word or phrase detected',
        confidence: 0.75,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      })),
    ];

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

  private detectRepetitions(
    sections: Array<{ id: string; content?: string }>,
  ): CopyEditPlan['repetitionHits'] {
    const wordCounts = new Map<
      string,
      Array<{ sectionId: string; startOffset: number; endOffset: number }>
    >();
    const STOP_WORDS = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'of',
      'for',
      'with',
      'is',
      'was',
      'are',
      'were',
      'be',
      'been',
      'have',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
    ]);

    for (const section of sections) {
      const content = section.content ?? '';
      const words = content.match(/\b[a-zA-Z]{3,}\b/g) ?? [];
      let offset = 0;
      for (const word of words) {
        const lower = word.toLowerCase();
        if (STOP_WORDS.has(lower)) {
          offset = content.indexOf(word, offset) + word.length;
          continue;
        }
        const start = content.indexOf(word, offset);
        const end = start + word.length;
        if (!wordCounts.has(lower)) wordCounts.set(lower, []);
        wordCounts.get(lower)!.push({ sectionId: section.id, startOffset: start, endOffset: end });
        offset = end;
      }
    }

    const hits: CopyEditPlan['repetitionHits'] = [];
    for (const [word, occurrences] of wordCounts) {
      if (occurrences.length >= 5) {
        hits.push({
          id: `rep-${word}`,
          wordOrPhrase: word,
          occurrences: occurrences.slice(0, 10),
          count: occurrences.length,
          suggestion: `Consider varying "${word}" with synonyms.`,
        });
      }
    }

    return hits.sort((a, b) => b.count - a.count).slice(0, 20);
  }

  private deduplicateByRange<
    T extends { sectionId: string; startOffset: number; endOffset: number },
  >(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.sectionId}-${item.startOffset}-${item.endOffset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
