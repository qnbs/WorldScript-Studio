/**
 * BaseAgent — Shared scaffolding for all ProForge pipeline agents.
 * QNBS-v3: Eliminates the ~30-line constructor/setup skeleton duplicated across 8 agents.
 */

import type { PipelineStage, StageResult } from '../../../features/proForge/types';
import type { AIProvider, AiModel } from '../../../types';
import { type InferenceGateway, inferenceGateway } from '../../ai/inferenceGateway';
import type { AIRequestOptions } from '../../aiProviderService';
import { logger } from '../../logger';
import { getMemoryBank, type ProForgeMemoryBank } from '../proForgeMemoryBank';
import type { OrchestratorContext } from '../proForgeOrchestrator';

export abstract class BaseAgent {
  protected readonly context: OrchestratorContext;
  // QNBS-v3: Gateway injected from context or falls back to module singleton — keeps agents testable.
  protected readonly gateway: InferenceGateway;
  // QNBS-v3: Supervisor feedback from the previous failed attempt; prepended to the next prompt
  // so a retry is materially different instead of re-rolling the identical request.
  private retryFeedback = '';

  constructor(context: OrchestratorContext) {
    this.context = context;
    this.gateway = context.gateway ?? inferenceGateway;
  }

  /** Orchestrator-only: seed corrective feedback for a retry attempt. */
  setRetryFeedback(feedback: string): void {
    this.retryFeedback = feedback;
  }

  abstract execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>>;

  protected requireProject() {
    const project = this.context.getState().project.present?.data;
    if (!project) throw new Error('No project data');
    return project;
  }

  protected getMemoryBank(): ProForgeMemoryBank {
    return getMemoryBank(this.context.projectId);
  }

  // QNBS-v3: Assemble memory context for a stage. Honours the run's ragMode — a story-anchored
  // query (title/logline/genre) drives semantic/hybrid relevance ranking of lore/character/prior
  // entries; with ragMode 'lexical' (or no project) it degrades to keyword/chronological recall.
  protected async gatherMemoryContext(stage: PipelineStage, maxChars: number): Promise<string> {
    const project = this.context.getState().project.present?.data;
    const query = project
      ? [project.title, project.logline, this.context.config.genrePreset]
          .filter(Boolean)
          .join(' ')
          .trim()
      : '';
    return this.getMemoryBank().buildContextString(
      stage,
      query || undefined,
      maxChars,
      this.context.config.ragMode,
    );
  }

  protected elapsed(startTime: number): number {
    return Math.round(performance.now() - startTime);
  }

  // QNBS-v3: Convenience wrapper — agents call this.generate(prompt) instead of the 3-line
  // aiProviderService.generateText(prompt, creativity, this.buildAiOpts(...)) pattern.
  protected async generate(prompt: string, maxTokens?: number): Promise<string> {
    // QNBS-v3: exactOptionalPropertyTypes — only pass maxTokens when it's defined.
    const result = await this.gateway.generate({
      prompt: this.withRetryPreamble(prompt),
      creativity: this.context.config.creativity,
      options: this.buildAiOpts(maxTokens !== undefined ? { maxTokens } : undefined),
    });
    return result.text;
  }

  // QNBS-v3: Prepend corrective guidance from the prior failed attempt so the model addresses
  // the supervisor's concerns rather than repeating the same output.
  private withRetryPreamble(prompt: string): string {
    if (!this.retryFeedback) return prompt;
    return `IMPORTANT — your previous attempt was rejected by the quality reviewer for these reasons:
${this.retryFeedback}

Produce a corrected response that resolves the issues above. Do not repeat the prior output.

${prompt}`;
  }

  // QNBS-v3: Builds AIRequestOptions from context.config — provider/model defaulting for pipeline agents.
  protected buildAiOpts(overrides?: {
    maxTokens?: number;
    signal?: AbortSignal;
  }): AIRequestOptions {
    const cfg = this.context.config;
    const provider = (cfg.aiProvider || 'gemini') as AIProvider;
    const modelMap: Partial<Record<AIProvider, AiModel>> = {
      gemini: 'gemini-2.5-flash',
      openai: 'gpt-4o-mini',
      anthropic: 'claude-haiku-4-5',
      grok: 'grok-3-mini',
    };
    const model: AiModel = modelMap[provider] ?? 'gemini-2.5-flash';
    return {
      model,
      provider,
      maxTokens: overrides?.maxTokens ?? cfg.maxTokens ?? 8192,
      ...(overrides?.signal !== undefined && { signal: overrides.signal }),
    };
  }

  // QNBS-v3: Lightweight coherence check — one focused AI call, max 100 tokens.
  // Returns coherent=true on any error so reflection never blocks the pipeline.
  protected async selfReflect(
    manuscriptExcerpt: string,
    analysisSummary: string,
    signal: AbortSignal,
  ): Promise<{ coherent: boolean; note: string; tokensUsed: number }> {
    if (signal.aborted)
      return { coherent: true, note: 'Reflection skipped (aborted)', tokensUsed: 0 };
    const prompt = `Evaluate whether this manuscript analysis is coherent and grounded in the actual text below. Reply with EXACTLY:
COHERENT: <one sentence>
or
INCOHERENT: <one sentence>

MANUSCRIPT EXCERPT:
${manuscriptExcerpt.substring(0, 800)}

ANALYSIS SUMMARY:
${analysisSummary.substring(0, 400)}`;

    try {
      // QNBS-v3: selfReflect routes through gateway for consistent retry + policy handling.
      const response = await this.gateway.generate({
        prompt,
        creativity: 'Focused',
        options: this.buildAiOpts({ maxTokens: 100 }),
      });
      const coherent = response.text.trim().toUpperCase().startsWith('COHERENT');
      return { coherent, note: response.text.trim(), tokensUsed: response.text.length };
    } catch (err) {
      logger.warn('BaseAgent.selfReflect: reflection call failed, proceeding as coherent:', err);
      return { coherent: true, note: 'Reflection skipped (AI error)', tokensUsed: 0 };
    }
  }
}
