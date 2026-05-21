import { Type } from '@google/genai';
import type { RootState } from '../../../app/store';
import { assembleRAGPrompt } from '../../../services/ragPromptAssembly';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiCreativity, buildAiOptions, loadAiProvider } from './thunkUtils';

export interface PlotBeatSuggestion {
  title: string;
  description: string;
  suggestedPosition: string;
  rationale: string;
}

export interface SuggestNextBeatArg {
  plotSummary: string;
  selectedSectionIds: string[];
  lang: string;
}

export const suggestNextBeatThunk = createDeduplicatedThunk(
  'project/suggestNextBeat',
  async (arg: SuggestNextBeatArg, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present?.data;
    if (!project) throw new Error('No project loaded');

    const projectId = project.id || 'default';
    const ragMode = state.settings.advancedAi.ragMode ?? 'hybrid';
    const duckDbEnabled = state.featureFlags.enableDuckDbAnalytics;

    const assembled = await assembleRAGPrompt(
      'plotSuggestion',
      {
        projectId,
        plotSummary: arg.plotSummary,
        selectedSectionIds: arg.selectedSectionIds,
        lang: arg.lang,
        manuscript: project.manuscript,
      },
      {
        topK: 8,
        ragMode,
        maxTokens: 6000,
        duckDbEnabled,
        useRag: true,
      },
    );

    registerDuplicateRequest(assembled.prompt, 'plotSuggestion');

    const creativity = buildAiCreativity(state);
    const aiOptions = buildAiOptions(state);
    const { generateJson } = await loadAiProvider();

    const schema = {
      type: Type.OBJECT,
      properties: {
        beats: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              suggestedPosition: { type: Type.STRING },
              rationale: { type: Type.STRING },
            },
            required: ['title', 'description', 'suggestedPosition', 'rationale'],
          },
        },
      },
      required: ['beats'],
    };

    const result = await generateJson<{ beats: PlotBeatSuggestion[] }>(
      assembled.prompt,
      creativity,
      schema,
      aiOptions,
      signal,
    );

    return { beats: result.beats ?? [], ragChunkCount: assembled.chunks.length };
  },
);
