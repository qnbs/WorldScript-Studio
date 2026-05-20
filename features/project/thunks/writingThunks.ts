import type { RootState } from '../../../app/store';
import { storageService } from '../../../services/storageService';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiCreativity, buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateLoglineSuggestionsThunk = createDeduplicatedThunk(
  'project/generateLogline',
  async (lang: string, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = buildAiCreativity(state);
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
    const creativity = buildAiCreativity(state);
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
    const creativity = buildAiCreativity(state);
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

export const generateSceneImageThunk = createDeduplicatedThunk(
  'project/generateSceneImage',
  async (
    payload: {
      sectionId: string;
      sectionTitle: string;
      sectionContent: string;
      projectTitle: string;
      lang: string;
    },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateImage } = await loadAiProvider();
    const { prompt } = getPrompts('sceneVisualization', {
      sectionTitle: payload.sectionTitle,
      sectionContent: payload.sectionContent,
      projectTitle: payload.projectTitle,
      lang: payload.lang,
    });
    registerDuplicateRequest(prompt, 'sceneVisualization');
    const base64 = await generateImage(prompt, aiOptions, signal);
    const imageKey = `scene-${payload.sectionId}`;
    await storageService.saveImage(imageKey, base64);
    const dataUrl = base64.includes('data:image') ? base64 : `data:image/png;base64,${base64}`;
    return { imageKey, dataUrl };
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
    const creativity = buildAiCreativity(state);
    const fullPrompt = `${prompt}\n\nRespond in ${lang === 'de' ? 'German' : 'English'}.`;
    registerDuplicateRequest(fullPrompt, 'streamGeneration');
    const { streamText } = await loadAiProvider();
    await streamText(fullPrompt, creativity, aiOptions, { onChunk }, signal);
  },
);
