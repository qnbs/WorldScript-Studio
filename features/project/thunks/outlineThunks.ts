import type { RootState } from '../../../app/store';
// QNBS-v3: type-only (elided at runtime); the generator is registered via a lazy import inside the
// thunk so it never enters the store's static graph (keeps partial logger mocks in store tests intact).
import type { OutlineHeuristicLabels } from '../../../services/ai/heuristicFallback/generators/outlineGenerator';
import type { CustomTemplateParams, OutlineGenerationParams, OutlineSection } from '../../../types';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiCreativity, buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateOutlineThunk = createDeduplicatedThunk(
  'project/generateOutline',
  async (
    params: OutlineGenerationParams & { heuristicLabels?: OutlineHeuristicLabels },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const creativity = buildAiCreativity(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    // QNBS-v3: lazy-register the heuristic generator only when an outline is actually generated.
    await import('../../../services/ai/heuristicFallback/generators/outlineGenerator');
    const { prompt, schema } = getPrompts('outline', params);
    registerDuplicateRequest(prompt, 'outline');
    // QNBS-v3: attach the heuristic fallback — schema-valid OutlineSection[] from pre-resolved labels
    // when the AI call is terminally unavailable (generateJson otherwise just throws for Gemini).
    const optsWithFallback: typeof aiOptions = {
      ...aiOptions,
      heuristicTask: 'outline',
      heuristicContext: {
        reasonKey: 'error.fallback.generic',
        params: {
          numChapters: params.numChapters,
          includeTwist: params.includeTwist,
          idea: params.idea,
          labels: params.heuristicLabels,
        },
      },
    };
    return await generateJson<OutlineSection[]>(
      prompt,
      creativity,
      schema!,
      optsWithFallback,
      signal,
    );
  },
);

export const regenerateOutlineSectionThunk = createDeduplicatedThunk(
  'project/regenerateOutlineSection',
  async (
    {
      allSections,
      sectionToIndex,
      lang,
    }: { allSections: OutlineSection[]; sectionToIndex: number; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const creativity = buildAiCreativity(state);
    const { prompt, schema } = getPrompts('regenerateOutlineSection', {
      allSections,
      sectionToIndex,
      lang,
    });
    registerDuplicateRequest(prompt, 'regenerateOutlineSection');
    const response = await generateJson<OutlineSection>(
      prompt,
      creativity,
      schema!,
      aiOptions,
      signal,
    );
    return { index: sectionToIndex, newSection: response };
  },
);

export const personalizeTemplateThunk = createDeduplicatedThunk(
  'project/personalizeTemplate',
  async (
    { sections, concept, lang }: { sections: { title: string }[]; concept: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('personalizeTemplate', { sections, concept, lang });
    const creativity = buildAiCreativity(state);
    registerDuplicateRequest(prompt, 'personalizeTemplate');
    return await generateJson<{ title: string; prompt: string }[]>(
      prompt,
      creativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const generateCustomTemplateThunk = createDeduplicatedThunk(
  'project/generateCustomTemplate',
  async (params: CustomTemplateParams, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('customTemplate', params);
    const creativity = buildAiCreativity(state);
    registerDuplicateRequest(prompt, 'customTemplate');
    return await generateJson<{ title: string }[]>(prompt, creativity, schema!, aiOptions, signal);
  },
);
