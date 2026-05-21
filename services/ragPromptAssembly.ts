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

export function buildRAGContextBlock(
  chunks: RagChunk[],
  manuscript: StorySection[] | undefined,
  tokenBudget: number,
): string {
  if (chunks.length === 0) return '';
  let used = 0;
  const lines: string[] = [];
  for (const c of chunks) {
    const title = sectionTitleFor(c.sectionId, manuscript);
    const header = `[${title} · chunk ${c.chunkIndex + 1} · score ${c.score.toFixed(2)}]`;
    const body = truncateAtSentence(c.text, MAX_TOKENS_PER_CHUNK * 4);
    const block = `${header}\n${body}`;
    const cost = estimateTokens(block);
    if (used + cost > tokenBudget) break;
    lines.push(block);
    used += cost;
  }
  return lines.join('\n\n---\n\n');
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
  const ragBlock = buildRAGContextBlock(chunks, context.manuscript, ragTokenBudget);

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
