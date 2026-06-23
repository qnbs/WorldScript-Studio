/**
 * RAG-aware prompt assembly for Writer continuation, Plot Board suggestions, and shared flows.
 * QNBS-v3: Centralises retrieval + token budgeting + template injection.
 */

import type { StorySection } from '../types';
import { embedText } from './ai/localEmbeddingService';
import { type RagChunk, type RagMode, retrieveContext } from './localRagService';
import { logger } from './logger';
import { getPrompt } from './promptLibrary';

export type RagPromptTask = 'writerContinuation' | 'plotSuggestion' | 'consistencyCheck';

export interface RagAssemblyOptions {
  topK: number;
  ragMode: RagMode;
  maxTokens: number;
  duckDbEnabled: boolean;
  useRag: boolean;
}

export interface WriterRAGContext {
  projectId: string;
  sectionId?: string | undefined;
  sectionTitle?: string | undefined;
  currentText: string;
  cursorPosition?: number | undefined;
  style?: string | undefined;
  lang: string;
  manuscript?: StorySection[] | undefined;
}

export interface PlotRAGContext {
  projectId: string;
  plotSummary: string;
  selectedSectionIds: string[];
  lang: string;
  manuscript?: StorySection[] | undefined;
}

export interface AssembledRAGPrompt {
  prompt: string;
  chunks: RagChunk[];
  estimatedTokens: number;
  ragUsed: boolean;
}

const RAG_BUDGET_RATIO = 0.65;
const MAX_TOKENS_PER_CHUNK = 180;

export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.3);
}

function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
  return lastPeriod > maxChars * 0.5 ? slice.slice(0, lastPeriod + 1) : `${slice}…`;
}

function sectionTitleFor(sectionId: string, manuscript?: StorySection[] | undefined): string {
  const sec = manuscript?.find((s) => s.id === sectionId);
  return sec?.title ?? sectionId;
}

export function deduplicateChunksBySection(chunks: RagChunk[]): RagChunk[] {
  const bySection = new Map<string, RagChunk>();
  for (const c of chunks) {
    const prev = bySection.get(c.sectionId);
    if (!prev || c.score > prev.score) bySection.set(c.sectionId, c);
  }
  return Array.from(bySection.values()).sort((a, b) => b.score - a.score);
}

// QNBS-v3 (CodeAnt): fit chunks under the token budget, returning BOTH the rendered block and the
// chunks actually included. The tail that doesn't fit is dropped — so callers (e.g. the transparency
// inspector) can show only the chunks that really made it into the prompt, not all retrieved ones.
const CHUNK_SEPARATOR = '\n\n---\n\n';

export function fitRagChunks(
  chunks: RagChunk[],
  manuscript: StorySection[] | undefined,
  tokenBudget: number,
): { used: RagChunk[]; block: string } {
  const used: RagChunk[] = [];
  const lines: string[] = [];
  let cost = 0;
  for (const c of chunks) {
    const title = sectionTitleFor(c.sectionId, manuscript);
    const header = `[${title} · chunk ${c.chunkIndex + 1} · score ${c.score.toFixed(2)}]`;
    const body = truncateAtSentence(c.text, MAX_TOKENS_PER_CHUNK * 4);
    const block = `${header}\n${body}`;
    // QNBS-v3 (CodeAnt): include the separator joined before every block after the first, so the
    // budget reflects the real rendered length and ragBlock can't exceed tokenBudget.
    const blockCost =
      estimateTokens(block) + (used.length > 0 ? estimateTokens(CHUNK_SEPARATOR) : 0);
    if (cost + blockCost > tokenBudget) break;
    used.push(c);
    lines.push(block);
    cost += blockCost;
  }
  return { used, block: lines.join(CHUNK_SEPARATOR) };
}

export function buildRAGContextBlock(
  chunks: RagChunk[],
  manuscript: StorySection[] | undefined,
  tokenBudget: number,
): string {
  return fitRagChunks(chunks, manuscript, tokenBudget).block;
}

async function fetchRagChunks(
  projectId: string,
  query: string,
  options: RagAssemblyOptions,
): Promise<RagChunk[]> {
  if (!options.useRag) return [];

  let queryEmb: Float32Array | undefined;
  if (options.ragMode === 'hybrid' || options.ragMode === 'semantic') {
    queryEmb = await embedText(query.slice(0, 500)).catch(() => undefined);
  }
  const raw = await retrieveContext(
    projectId,
    query,
    options.topK,
    options.ragMode,
    queryEmb,
    options.duckDbEnabled && Boolean(queryEmb),
  );
  return deduplicateChunksBySection(raw).slice(0, options.topK);
}

export async function assembleRAGPrompt(
  task: RagPromptTask,
  context: WriterRAGContext | PlotRAGContext,
  options: RagAssemblyOptions,
): Promise<AssembledRAGPrompt> {
  const query =
    task === 'writerContinuation'
      ? (context as WriterRAGContext).currentText.slice(
          0,
          Math.max(0, (context as WriterRAGContext).cursorPosition ?? 500),
        ) || (context as WriterRAGContext).currentText.slice(0, 500)
      : (context as PlotRAGContext).plotSummary.slice(0, 500);

  let chunks: RagChunk[] = [];
  if (options.useRag) {
    try {
      chunks = await fetchRagChunks(context.projectId, query, options);
    } catch (err) {
      logger.warn('RAG retrieval failed (non-critical):', err);
    }
  }

  const ragTokenBudget = Math.floor(options.maxTokens * RAG_BUDGET_RATIO);
  // QNBS-v3 (CodeAnt): keep only the chunks that actually fit the budget (were injected), so the
  // transparency inspector never lists passages that were dropped before reaching the prompt.
  const { used: injectedChunks, block: ragBlock } = fitRagChunks(
    chunks,
    context.manuscript,
    ragTokenBudget,
  );
  chunks = injectedChunks;

  const templateId =
    task === 'writerContinuation'
      ? 'writerContinuationWithRAG'
      : task === 'plotSuggestion'
        ? 'plotSuggestionWithRAG'
        : 'consistencyCheck';

  const vars: Record<string, string> =
    task === 'writerContinuation'
      ? {
          currentText: (context as WriterRAGContext).currentText,
          style: (context as WriterRAGContext).style ?? 'compelling',
          ragContext: ragBlock,
          lang: context.lang,
        }
      : {
          plotSummary: (context as PlotRAGContext).plotSummary,
          ragContext: ragBlock,
          lang: context.lang,
        };

  const base = getPrompt(templateId, vars);
  const langLabel =
    context.lang === 'de'
      ? 'German'
      : context.lang === 'fr'
        ? 'French'
        : context.lang === 'es'
          ? 'Spanish'
          : context.lang === 'it'
            ? 'Italian'
            : 'English';
  const langLine = `\n\nRespond entirely in ${langLabel}.`;

  const fallbackId = task === 'writerContinuation' ? 'writerContinuation' : 'plotSuggestion';
  const body = ragBlock.length > 0 ? base : getPrompt(fallbackId, vars);
  const prompt = body.includes(langLine) ? body : `${body}${langLine}`;

  const estimatedTokens = estimateTokens(prompt);
  if (chunks.length === 0) {
    logger.debug(`[ragPromptAssembly] ${task}: no chunks, base prompt only`);
  }

  return {
    prompt,
    chunks,
    estimatedTokens,
    ragUsed: chunks.length > 0,
  };
}
