import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
// QNBS-v3: type-only (elided); the generator is lazy-imported inside the thunk to keep it out of the
// store's static graph (see docs/AI-HEURISTIC-FALLBACKS.md).
import type { CharacterHeuristicLabels } from '../../../services/ai/heuristicFallback/generators/characterGenerator';
import { storageService } from '../../../services/storageService';
import type { Character } from '../../../types';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import { buildAiCreativity, buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateCharacterProfileThunk = createDeduplicatedThunk(
  'project/generateCharacterProfile',
  async (
    {
      concept,
      lang,
      heuristicLabels,
    }: { concept: string; lang: string; heuristicLabels?: CharacterHeuristicLabels },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const creativity = buildAiCreativity(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    await import('../../../services/ai/heuristicFallback/generators/characterGenerator');
    const { prompt, schema } = getPrompts('characterProfile', { concept, lang });
    registerDuplicateRequest(prompt, 'characterProfile');
    const optsWithFallback: typeof aiOptions = {
      ...aiOptions,
      heuristicTask: 'character.profile',
      heuristicContext: {
        reasonKey: 'error.fallback.generic',
        params: { concept, labels: heuristicLabels },
      },
    };
    return await generateJson<Omit<Character, 'id'>>(
      prompt,
      creativity,
      schema!,
      optsWithFallback,
      signal,
    );
  },
);

export const regenerateCharacterFieldThunk = createDeduplicatedThunk(
  'project/regenerateCharacterField',
  async (
    { character, field, lang }: { character: Character; field: keyof Character; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateText } = await loadAiProvider();
    const { prompt } = getPrompts('regenerateCharacterField', { character, field, lang });
    registerDuplicateRequest(prompt, 'regenerateCharacterField');
    const creativity = buildAiCreativity(state);
    const response = await generateText(prompt, creativity, aiOptions, signal);
    return { field, value: response };
  },
);

export const generateCharacterPortraitThunk = createDeduplicatedThunk(
  'project/generateCharacterPortrait',
  async (
    {
      characterId,
      description,
      style,
      lang,
    }: { characterId: string; description: string; style?: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const fullDescription = style ? `${description}. Style: ${style}` : description;
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateImage } = await loadAiProvider();
    const { prompt } = getPrompts('characterPortrait', { description: fullDescription, lang });
    registerDuplicateRequest(prompt, 'characterPortrait');
    const base64 = await generateImage(prompt, aiOptions, signal);
    await storageService.saveImage(characterId, base64);
    return { characterId };
  },
);

export const uploadCharacterImageThunk = createAsyncThunk(
  'project/uploadCharacterImage',
  async ({ characterId, file }: { characterId: string; file: File }) => {
    return new Promise<{ characterId: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).replace(/^data:image\/\w+;base64,/, '');
        await storageService.saveImage(characterId, base64);
        resolve({ characterId });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
);
