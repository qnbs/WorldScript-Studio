import type { RootState } from '../../../app/store';
import type { CustomTemplateParams, OutlineGenerationParams, OutlineSection } from '../../../types';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateOutlineThunk = createDeduplicatedThunk(
  'project/generateOutline',
  async (params: OutlineGenerationParams, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('outline', params);
    registerDuplicateRequest(prompt, 'outline');
    return await generateJson<OutlineSection[]>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
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
    const { prompt, schema } = getPrompts('regenerateOutlineSection', {
      allSections,
      sectionToIndex,
      lang,
    });
    registerDuplicateRequest(prompt, 'regenerateOutlineSection');
    const response = await generateJson<OutlineSection>(
      prompt,
      state.settings.aiCreativity,
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
    registerDuplicateRequest(prompt, 'personalizeTemplate');
    return await generateJson<{ title: string; prompt: string }[]>(
      prompt,
      state.settings.aiCreativity,
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
    registerDuplicateRequest(prompt, 'customTemplate');
    return await generateJson<{ title: string }[]>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);
