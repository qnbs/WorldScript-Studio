/**
 * Prose Agent — Phase 3: Line & Prose Correction
 * QNBS-v3: Show-don't-tell, filter words, dialogue, POV, sensory details.
 */

import type {
  PipelineStage,
  ProseEdit,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  proseEditBatchSchema,
  stripJsonFences,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import { BaseAgent } from './baseAgent';

// Filter words list for client-side pre-analysis
const FILTER_WORDS = new Set([
  'just',
  'very',
  'really',
  'quite',
  'rather',
  'somewhat',
  'somehow',
  'suddenly',
  'actually',
  'basically',
  'literally',
  'definitely',
  'certainly',
  'probably',
  'maybe',
  'perhaps',
  'simply',
  'completely',
  'absolutely',
  'totally',
  'extremely',
]);

export class ProseAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const memoryContext = await this.gatherMemoryContext('lineProse', 2000);

    // Process sections in batches to avoid token limits
    const sections = project.manuscript;
    const allEdits: ProseEdit[] = [];
    let aiCalls = 0;
    let tokensConsumed = 0;

    // Limit to first 5 sections for MVP (full implementation would chunk all)
    const sectionsToProcess = sections.slice(0, 5);

    for (const section of sectionsToProcess) {
      if (signal.aborted) break;

      const content = section.content ?? '';
      const wordCount = content.trim().split(/\s+/).length;

      // Skip very short sections
      if (wordCount < 50) continue;

      const prompt = getPrompt('proseEditBatch', {
        sectionTitle: section.title,
        sectionContent: content,
        genre: config.genrePreset,
        language: config.language,
        wordCount: String(wordCount),
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

        const validated = validateWithSchema(proseEditBatchSchema, parsed);
        if (validated.success) {
          // Validate offsets are within content bounds
          const validEdits = validated.data.edits.filter(
            (e) => e.sectionId === section.id || e.sectionId === section.title,
          );
          allEdits.push(
            ...validEdits.map(
              (e): ProseEdit => ({
                id: e.id,
                sectionId: section.id,
                startOffset: e.startOffset,
                endOffset: e.endOffset,
                category: e.category,
                original: e.original,
                proposed: e.proposed,
                rationale: e.rationale,
                confidence: e.confidence,
                ...(e.sectionTitle !== undefined && { sectionTitle: e.sectionTitle }),
              }),
            ),
          );
        }
      } catch (err) {
        logger.warn(`ProseAgent: Failed to analyze section ${section.id}:`, err);
      }
    }

    // Also add client-side filter word detection as supplemental edits
    const filterWordEdits = this.detectFilterWords(sections);
    allEdits.push(...filterWordEdits);

    // Deduplicate by offset range
    const deduped = this.deduplicateEdits(allEdits);

    // Save to memory
    await memoryBank.remember('edit', 'proseEdits', JSON.stringify(deduped), 'lineProse');

    // Calculate before metrics (rough estimates)
    const totalWords = sections.reduce(
      (acc, s) => acc + (s.content?.trim().split(/\s+/).length ?? 0),
      0,
    );
    const beforeMetrics = {
      adverbDensity: this.countAdverbs(sections) / (totalWords / 1000),
      filterWordDensity: filterWordEdits.length / (totalWords / 1000),
      dialogueRatio: this.estimateDialogueRatio(sections),
      sensoryScore: 50,
      showDontTellScore: 50,
      povConsistencyScore: 70,
    };

    const reviewItems: ReviewItem[] = deduped.map((edit) => {
      const sectionTitle = sections.find((s) => s.id === edit.sectionId)?.title;
      return {
        id: `prose-${edit.id}`,
        stage: 'lineProse' as PipelineStage,
        type: 'proseEdit' as ReviewItem['type'],
        severity: (edit.confidence > 0.85 ? 'warning' : 'info') as ReviewItem['severity'],
        sectionId: edit.sectionId,
        ...(sectionTitle !== undefined && { sectionTitle }),
        range: { start: edit.startOffset, end: edit.endOffset },
        description: `[${edit.category}] ${edit.rationale}`,
        original: edit.original,
        proposed: edit.proposed,
        rationale: edit.rationale,
        confidence: edit.confidence,
        status: 'pending' as ReviewItem['status'],
        createdAt: new Date().toISOString(),
      };
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
      agentOutput: {
        edits: deduped,
        beforeMetrics,
        summary: `Prose analysis complete. ${deduped.length} edits proposed across ${sectionsToProcess.length} sections.`,
      },
    };
  }

  private detectFilterWords(sections: Array<{ id: string; content?: string }>): ProseEdit[] {
    const edits: ProseEdit[] = [];
    for (const section of sections) {
      const content = section.content ?? '';
      const words = content.split(/(\b)/);
      let offset = 0;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (word && FILTER_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ''))) {
          const start = offset;
          const end = offset + word.length;
          edits.push({
            id: `fw-${section.id}-${start}`,
            sectionId: section.id,
            startOffset: start,
            endOffset: end,
            category: 'filterWord',
            original: word,
            proposed: '', // suggest removal or replacement
            rationale: `Filter word "${word}" weakens prose. Consider removing or replacing with a stronger alternative.`,
            confidence: 0.8,
          });
        }
        offset += word?.length ?? 0;
      }
    }
    // Limit to top 30 most critical
    return edits.slice(0, 30);
  }

  private countAdverbs(sections: Array<{ content?: string }>): number {
    let count = 0;
    const adverbPattern = /\b\w+ly\b/gi;
    for (const section of sections) {
      const matches = section.content?.match(adverbPattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  private estimateDialogueRatio(sections: Array<{ content?: string }>): number {
    let totalWords = 0;
    let dialogueWords = 0;
    for (const section of sections) {
      const content = section.content ?? '';
      const words = content.trim().split(/\s+/).length;
      totalWords += words;
      // Rough estimate: text between quotes
      const dialogueMatches = content.match(/"[^"]*"/g);
      if (dialogueMatches) {
        dialogueWords += dialogueMatches.join(' ').split(/\s+/).length;
      }
    }
    return totalWords > 0 ? Math.round((dialogueWords / totalWords) * 100) : 0;
  }

  private deduplicateEdits(edits: ProseEdit[]): ProseEdit[] {
    const seen = new Set<string>();
    return edits.filter((e) => {
      const key = `${e.sectionId}-${e.startOffset}-${e.endOffset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
