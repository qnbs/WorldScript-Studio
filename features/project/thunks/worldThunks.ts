import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
// QNBS-v3: type-only (elided); generator lazy-imported inside the thunk (out of the store static graph).
import type { WorldHeuristicLabels } from '../../../services/ai/heuristicFallback/generators/worldGenerator';
import { storageService } from '../../../services/storageService';
import type { World } from '../../../types';
import { createDeduplicatedThunk } from '../aiThunkUtils';
import {
  assertProjectIdentityUnchanged,
  getProjectTargetIdentity,
  getProjectTargetStorageId,
} from '../projectIdentity';
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
    // QNBS-v3: capture the incarnation before generation so a same-ID replacement cannot inherit the result.
    const originIdentity = getProjectTargetIdentity(state.project.present);
    // QNBS-v3: threaded into saveImage so the stored key is project-qualified, not a bare entity id shared across projects.
    const projectId = getProjectTargetStorageId(state.project.present) ?? 'default';
    const aiOptions = buildAiOptions(state);
    const { getPrompts } = await loadPrompts();
    const { generateImage } = await loadAiProvider();
    const { prompt } = getPrompts('worldImage', { description, lang });
    registerDuplicateRequest(prompt, 'worldImage');
    const base64 = await generateImage(prompt, aiOptions, signal);
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity((getState() as RootState).project.present),
      'world image generation before storage',
    );
    // QNBS-v3: [Origin persistence authority / Reject stale writes at the backend boundary / Preserve world asset ownership]
    await storageService.saveImage(worldId, base64, projectId, () =>
      assertProjectIdentityUnchanged(
        originIdentity,
        getProjectTargetIdentity((getState() as RootState).project.present),
        'world image persistence',
      ),
    );
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity((getState() as RootState).project.present),
      'world image generation after storage',
    );
    return { worldId };
  },
);

export const uploadWorldImageThunk = createAsyncThunk(
  'project/uploadWorldImage',
  async ({ worldId, file }: { worldId: string; file: File }, { getState }) => {
    const state = getState() as RootState;
    const originIdentity = getProjectTargetIdentity(state.project.present);
    // QNBS-v3: [Origin storage owner / Keep upload/read namespaces aligned / Preserve legacy project visibility]
    const projectId = getProjectTargetStorageId(state.project.present) ?? 'default';
    return new Promise<{ worldId: string }>((resolve, reject) => {
      const reader = new FileReader();
      // QNBS-v3: onload/onerror/onabort (not onloadend) plus Promise.catch(reject) so every terminal FileReader/saveImage outcome settles this Promise instead of leaving it pending.
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('FileReader did not produce a string result'));
          return;
        }
        // QNBS-v3: [MIME-preserving upload / Keep backend round-trips lossless / Preserve user-selected image format]
        try {
          assertProjectIdentityUnchanged(
            originIdentity,
            getProjectTargetIdentity((getState() as RootState).project.present),
            'world image upload before storage',
          );
        } catch (error) {
          reject(error);
          return;
        }
        // QNBS-v3: retain the data-URL MIME type so uploaded JPEG/WebP images survive filesystem round-trips.
        storageService
          .saveImage(worldId, result, projectId, () =>
            assertProjectIdentityUnchanged(
              originIdentity,
              getProjectTargetIdentity((getState() as RootState).project.present),
              'world image upload persistence',
            ),
          )
          .then(() => {
            try {
              assertProjectIdentityUnchanged(
                originIdentity,
                getProjectTargetIdentity((getState() as RootState).project.present),
                'world image upload completion',
              );
              resolve({ worldId });
            } catch (error) {
              reject(error);
            }
          })
          .catch(reject);
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error('FileReader failed to read the file'));
      reader.onabort = () => reject(new Error('FileReader aborted'));
      reader.readAsDataURL(file);
    });
  },
);
