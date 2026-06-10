/**
 * Publishing Agent — Phase 7: Publishing Preparation
 * QNBS-v3: Metadata, blurbs, audiobook prep, marketing assets.
 */

import type { PublishingPackage, ReviewItem, StageResult } from '../../../features/proForge/types';
import { logger } from '../../logger';
import { getPrompt } from '../../promptLibrary';
import {
  publishingPackageSchema,
  stripJsonFences,
  validateWithSchema,
} from '../pipelineOutput/structuredOutput';
import { BaseAgent } from './baseAgent';

export class PublishingAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const { config } = this.context;
    const project = this.requireProject();
    const memoryBank = this.getMemoryBank();
    const memoryContext = await this.gatherMemoryContext('publishing', 2000);

    const totalWords = project.manuscript.reduce(
      (acc, s) => acc + (s.content?.trim().split(/\s+/).length ?? 0),
      0,
    );
    const excerpt = project.manuscript
      .slice(0, 2)
      .map((s) => s.content?.substring(0, 500))
      .join('\n\n');

    const prompt = getPrompt('publishingPackage', {
      title: project.title,
      logline: project.logline,
      genre: config.genrePreset,
      language: config.language,
      wordCount: String(totalWords),
      excerpt,
      memoryContext,
    });

    let pkg: PublishingPackage;
    let aiCalls = 0;
    let tokensConsumed = 0;

    try {
      const response = await this.generate(prompt, Math.min(config.maxTokens, 4000));
      aiCalls += 1;
      tokensConsumed += response.length;

      if (signal.aborted) throw new Error('Publishing prep aborted');

      const cleaned = stripJsonFences(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      }

      const validated = validateWithSchema(publishingPackageSchema, parsed);
      if (!validated.success) {
        logger.warn('PublishingAgent: Schema validation failed:', validated.error);
        pkg = this.createFallbackPackage(project, totalWords);
      } else {
        pkg = validated.data as PublishingPackage;
      }
    } catch (err) {
      logger.error('PublishingAgent: AI call failed:', err);
      pkg = this.createFallbackPackage(project, totalWords);
    }

    await memoryBank.remember('meta', 'publishingPackage', JSON.stringify(pkg), 'publishing');

    const reviewItems: ReviewItem[] = [
      {
        id: 'pub-metadata',
        stage: 'publishing',
        type: 'consistencyIssue',
        severity: 'info',
        description: `Book Metadata: "${pkg.metadata.title}" by ${pkg.metadata.author} | Genre: ${pkg.metadata.genre} | Words: ${pkg.metadata.wordCount}`,
        rationale: 'Publishing metadata generated',
        confidence: 1.0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'pub-blurb',
        stage: 'publishing',
        type: 'consistencyIssue',
        severity: 'info',
        description: `Tagline: "${pkg.blurbs.tagline}"`,
        rationale: 'Marketing blurb generated',
        confidence: 0.9,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'pub-audiobook',
        stage: 'publishing',
        type: 'technicalIssue',
        severity: 'info',
        description: `Audiobook guide: ${pkg.audiobookGuide.chapterMarks.length} chapter marks prepared`,
        rationale: 'Audiobook preparation complete',
        confidence: 1.0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
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
      agentOutput: pkg,
    };
  }

  private createFallbackPackage(
    project: { title: string; logline: string },
    wordCount: number,
  ): PublishingPackage {
    return {
      metadata: {
        title: project.title,
        author: 'Author',
        description: project.logline,
        keywords: ['fiction', 'novel'],
        genre: 'Fiction',
        bisacCodes: ['FIC000000'],
        language: 'en',
        wordCount,
      },
      blurbs: {
        backCover: project.logline,
        amazonDescription: project.logline,
        tagline: project.title,
        elevatorPitch: project.logline,
        socialMediaPosts: [project.logline],
      },
      audiobookGuide: {
        chapterMarks: [],
        overallNotes: 'Audiobook guide not generated. Please configure an AI provider.',
      },
      marketingAssets: {
        socialMediaPosts: [],
        newsletterText: project.logline,
        adCopyVariants: [],
        authorBioSuggestion: '',
      },
      rightsPage: `© ${new Date().getFullYear()} Author. All rights reserved.`,
    };
  }
}
