import type { RootState } from '../../../app/store';
import { storageService } from '../../../services/storageService';
import { assertAiRequestActive, createDeduplicatedThunk } from '../aiThunkUtils';
import {
  assertProjectIdentityUnchanged,
  getProjectTargetIdentity,
  getProjectTargetStorageId,
} from '../projectIdentity';
import { buildAiCreativity, buildAiOptions, loadAiProvider, loadPrompts } from './thunkUtils';

export const generateLoglineSuggestionsThunk = createDeduplicatedThunk(
  'project/generateLogline',
  async (lang: string, { getState, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = buildAiCreativity(state);
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { prompt, schema } = getPrompts('logline', { project, lang });
    // QNBS-v3: register logline supersession before provider loading so duplicate dispatches cancel at entry.
    const signal = registerDuplicateRequest(prompt, 'logline');
    const { generateJson } = await loadAiProvider();
    return await generateJson<string[]>(prompt, creativity, schema!, aiOptions, signal);
  },
);

export const generateSynopsisThunk = createDeduplicatedThunk(
  'project/generateSynopsis',
  async (lang: string, { getState, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = buildAiCreativity(state);
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateText } = await loadAiProvider();
    const { prompt } = getPrompts('synopsis', { project, lang });
    const signal = registerDuplicateRequest(prompt, 'synopsis');
    return await generateText(prompt, creativity, aiOptions, signal);
  },
);

export const proofreadTextThunk = createDeduplicatedThunk(
  'project/proofreadText',
  async (
    { text, lang }: { text: string; lang: string },
    { getState, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const creativity = buildAiCreativity(state);
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateJson } = await loadAiProvider();
    const { prompt, schema } = getPrompts('proofread', { text, lang });
    const signal = registerDuplicateRequest(prompt, 'proofread');
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
    { getState, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    // QNBS-v3: capture the incarnation before generation so a same-ID replacement cannot inherit the result.
    const originIdentity = getProjectTargetIdentity(state.project.present);
    // QNBS-v3: threaded into saveImage so the stored key is project-qualified, not a bare entity id shared across projects.
    const projectId = getProjectTargetStorageId(state.project.present) ?? 'default';
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateImage } = await loadAiProvider();
    const { prompt } = getPrompts('sceneVisualization', {
      sectionTitle: payload.sectionTitle,
      sectionContent: payload.sectionContent,
      projectTitle: payload.projectTitle,
      lang: payload.lang,
    });
    // QNBS-v3: section scope keeps identical prompts for separate scene owners independent.
    const signal = registerDuplicateRequest(prompt, 'sceneVisualization', payload.sectionId);
    const base64 = await generateImage(prompt, aiOptions, signal);
    const imageKey = `scene-${payload.sectionId}`;
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity((getState() as RootState).project.present),
      'scene image generation before storage',
    );
    // QNBS-v3: the backend must re-check incarnation authority at its final image-write point, not only before/after the asynchronous storage call.
    await storageService.saveImage(imageKey, base64, projectId, (): undefined => {
      assertAiRequestActive(signal);
      assertProjectIdentityUnchanged(
        originIdentity,
        getProjectTargetIdentity((getState() as RootState).project.present),
        'scene image persistence',
      );
      return undefined;
    });
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity((getState() as RootState).project.present),
      'scene image generation after storage',
    );
    const dataUrl = base64.includes('data:image') ? base64 : `data:image/png;base64,${base64}`;
    return { imageKey, dataUrl };
  },
  undefined,
  'image',
);

export const streamGenerationThunk = createDeduplicatedThunk(
  'project/streamGeneration',
  async (
    { prompt, lang, onChunk }: { prompt: string; lang: string; onChunk: (chunk: string) => void },
    { getState, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const creativity = buildAiCreativity(state);
    const fullPrompt = `${prompt}\n\nRespond in ${lang === 'de' ? 'German' : 'English'}.`;
    const signal = registerDuplicateRequest(fullPrompt, 'streamGeneration');
    const { streamText } = await loadAiProvider();
    await streamText(fullPrompt, creativity, aiOptions, { onChunk }, signal);
  },
);
