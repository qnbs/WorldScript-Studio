/**
 * BaseAgent — Shared scaffolding for all ProForge pipeline agents.
 * QNBS-v3: Eliminates the ~30-line constructor/setup skeleton duplicated across 8 agents.
 */

import type { StageResult } from '../../../features/proForge/types';
import { aiProviderService } from '../../aiProviderService';
import { logger } from '../../logger';
import { getMemoryBank, type ProForgeMemoryBank } from '../proForgeMemoryBank';
import type { OrchestratorContext } from '../proForgeOrchestrator';

export abstract class BaseAgent {
  protected readonly context: OrchestratorContext;

  constructor(context: OrchestratorContext) {
    this.context = context;
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

  protected elapsed(startTime: number): number {
    return Math.round(performance.now() - startTime);
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
      const response = await aiProviderService.generateText(prompt, 'Focused', {
        maxOutputTokens: 100,
      });
      const coherent = response.trim().toUpperCase().startsWith('COHERENT');
      return { coherent, note: response.trim(), tokensUsed: response.length };
    } catch (err) {
      logger.warn('BaseAgent.selfReflect: reflection call failed, proceeding as coherent:', err);
      return { coherent: true, note: 'Reflection skipped (AI error)', tokensUsed: 0 };
    }
  }
}
