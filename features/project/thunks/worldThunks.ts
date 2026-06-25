import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
// QNBS-v3: type-only (elided); generator lazy-imported inside the thunk (out of the store static graph).
import type { WorldHeuristicLabels } from '../../../services/ai/heuristicFallback/generators/worldGenerator';
import { storageService } from '../../../services/storageService';
import type { World } from '../../../types';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiCreativity, buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateWorldProfileThunk = createDeduplicatedThunk(
  'project/generateWorldProfile',
  async (
    {
      concept,
      lang,
      heuristicLabels,
    }: { concept: string; lang: string; heuristicLabels?: WorldHeuristicLabels },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    await import('../../../services/ai/heuristicFallback/generators/worldGenerator');
    const { prompt, schema } = getPrompts('worldProfile', { concept, lang });
    registerDuplicateRequest(prompt, 'worldProfile');
    const creativity = buildAiCreativity(state);
    const optsWithFallback: typeof aiOptions = {
      ...aiOptions,
      heuristicTask: 'world.profile',
      heuristicContext: {
        reasonKey: 'error.fallback.generic',
        params: { concept, labels: heuristicLabels },
      },
    };
    return await generateJson<Omit<World, 'id'>>(
      prompt,
      creativity,
      schema!,
      optsWithFallback,
      signal,
    );
  },
);

export const regenerateWorldFieldThunk = createDeduplicatedThunk(
  'project/regenerateWorldField',
  async (
    { world, field, lang }: { world: World; field: keyof World; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateText } = await loadAiProvider();
    const { prompt } = getPrompts('regenerateWorldField', { world, field, lang });
    registerDuplicateRequest(prompt, 'regenerateWorldField');
    const creativity = buildAiCreativity(state);
    const response = await generateText(prompt, creativity, aiOptions, signal);
    return { field, value: response };
  },
);

export const generateWorldImageThunk = createDeduplicatedThunk(
  'project/generateWorldImage',
  async (
    { worldId, description, lang }: { worldId: string; description: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateImage } = await loadAiProvider();
    const { prompt } = getPrompts('worldImage', { description, lang });
    registerDuplicateRequest(prompt, 'worldImage');
    const base64 = await generateImage(prompt, aiOptions, signal);
    await storageService.saveImage(worldId, base64);
    return { worldId };
  },
);

export const uploadWorldImageThunk = createAsyncThunk(
  'project/uploadWorldImage',
  async ({ worldId, file }: { worldId: string; file: File }) => {
    return new Promise<{ worldId: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).replace(/^data:image\/\w+;base64,/, '');
        await storageService.saveImage(worldId, base64);
        resolve({ worldId });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
);
