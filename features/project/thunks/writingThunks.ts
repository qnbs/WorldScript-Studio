import type { RootState } from '../../../app/store';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateLoglineSuggestionsThunk = createDeduplicatedThunk(
  'project/generateLogline',
  async (lang: string, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('logline', { project, lang });
    registerDuplicateRequest(prompt, 'logline');
    return await generateJson<string[]>(prompt, creativity, schema!, aiOptions, signal);
  },
);

export const generateSynopsisThunk = createDeduplicatedThunk(
  'project/generateSynopsis',
  async (lang: string, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateText } = await loadAiProvider();
    const { prompt } = getPrompts('synopsis', { project, lang });
    registerDuplicateRequest(prompt, 'synopsis');
    return await generateText(prompt, creativity, aiOptions, signal);
  },
);

export const proofreadTextThunk = createDeduplicatedThunk(
  'project/proofreadText',
  async (
    { text, lang }: { text: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('proofread', { text, lang });
    registerDuplicateRequest(prompt, 'proofread');
    return await generateJson<{ original: string; suggestion: string; explanation: string }[]>(
      prompt,
      creativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const streamGenerationThunk = createDeduplicatedThunk(
  'project/streamGeneration',
  async (
    { prompt, lang, onChunk }: { prompt: string; lang: string; onChunk: (chunk: string) => void },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const fullPrompt = `${prompt}\n\nRespond in ${lang === 'de' ? 'German' : 'English'}.`;
    registerDuplicateRequest(fullPrompt, 'streamGeneration');
    const { streamText } = await loadAiProvider();
    await streamText(fullPrompt, state.settings.aiCreativity, aiOptions, { onChunk }, signal);
  },
);
