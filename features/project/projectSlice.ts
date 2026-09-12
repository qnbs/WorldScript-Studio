import { createSlice } from '@reduxjs/toolkit';
import { charactersAdapter, worldsAdapter } from './adapters';
import { getProjectTargetIdentity, identityUnchanged } from './projectIdentity';
import { initialState, type ProjectData } from './projectState';
// QNBS-v3: Reducer cases are split into domain modules under ./reducers/* so this slice stays thin.
// Action names, the `project/*` namespace, the single redux-undo wrapper (app/store.ts), and the
// ProjectData shape are all unchanged — this is a pure file decomposition, no behavior change.
import { binderReducers } from './reducers/binderReducers';
import { characterReducers } from './reducers/characterReducers';
import { interviewReducers } from './reducers/interviewReducers';
import { manuscriptReducers } from './reducers/manuscriptReducers';
import { metaReducers } from './reducers/metaReducers';
import { mindMapReducers } from './reducers/mindMapReducers';
import { outlineReducers } from './reducers/outlineReducers';
import { plotReducers } from './reducers/plotReducers';
import { relationshipReducers } from './reducers/relationshipReducers';
import { storyObjectReducers } from './reducers/storyObjectReducers';
import { worldReducers } from './reducers/worldReducers';
import { writingAnalyticsReducers } from './reducers/writingAnalyticsReducers';
import {
  generateCharacterPortraitThunk,
  uploadCharacterImageThunk,
} from './thunks/characterThunks';
import { importProjectThunk, restoreSnapshotThunk } from './thunks/projectManagementThunks';
import { generateWorldImageThunk, uploadWorldImageThunk } from './thunks/worldThunks';

// --- Re-exports for consumers ---
export { charactersAdapter, worldsAdapter } from './adapters';
export { createDeduplicatedThunk } from './aiThunkUtils';
export type { ProjectData } from './projectState';
export {
  importBinderFileThunk,
  removeBinderSubtreeWithAssetsThunk,
} from './thunks/binderThunks';
export {
  generateCharacterPortraitThunk,
  generateCharacterProfileThunk,
  regenerateCharacterFieldThunk,
  uploadCharacterImageThunk,
} from './thunks/characterThunks';
export {
  generateCustomTemplateThunk,
  generateOutlineThunk,
  personalizeTemplateThunk,
  regenerateOutlineSectionThunk,
} from './thunks/outlineThunks';
export { importProjectThunk, restoreSnapshotThunk } from './thunks/projectManagementThunks';
export {
  generateWorldImageThunk,
  generateWorldProfileThunk,
  regenerateWorldFieldThunk,
  uploadWorldImageThunk,
} from './thunks/worldThunks';
export {
  generateLoglineSuggestionsThunk,
  generateSynopsisThunk,
  proofreadTextThunk,
  streamGenerationThunk,
} from './thunks/writingThunks';

// --- Slice Definition ---
const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    ...metaReducers,
    ...characterReducers,
    ...worldReducers,
    ...outlineReducers,
    ...manuscriptReducers,
    ...relationshipReducers,
    ...plotReducers,
    ...writingAnalyticsReducers,
    ...binderReducers,
    ...storyObjectReducers,
    ...mindMapReducers,
    ...interviewReducers,
  },
  extraReducers: (builder) => {
    builder
      .addCase(importProjectThunk.fulfilled, (state, action) => {
        state.data = action.payload;
        // QNBS-v3: distinguishes this import from any other project state that also happens to keep the same id; nullish-coalesced since some hand-built test store fixtures predate this field.
        state.generation = (state.generation ?? 0) + 1;
      })
      .addCase(restoreSnapshotThunk.fulfilled, (state, action) => {
        state.data = action.payload as ProjectData;
        // QNBS-v3: distinguishes this restore from any other project state that also happens to keep the same id; nullish-coalesced since some hand-built test store fixtures predate this field.
        state.generation = (state.generation ?? 0) + 1;
      })
      .addCase(generateCharacterPortraitThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(uploadCharacterImageThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(generateWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      })
      .addCase(uploadWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      })
      // QNBS-v3: streaming interview chunks update the AI message content in-place without N separate actions
      .addMatcher(
        (
          action,
        ): action is {
          type: 'project/streamInterviewChunk';
          payload: {
            characterId: string;
            interviewId: string;
            aiMsgId: string;
            content: string;
            originIdentity: string;
          };
        } => action.type === 'project/streamInterviewChunk',
        (state, action) => {
          // QNBS-v3: reject chunks from a replaced incarnation before they can mutate the active interview.
          if (!identityUnchanged(action.payload.originIdentity, getProjectTargetIdentity(state))) {
            return;
          }
          const { characterId, interviewId, aiMsgId, content } = action.payload;
          const interviews = state.data.characterInterviews?.[characterId] ?? [];
          const interview = interviews.find((iv) => iv.id === interviewId);
          if (!interview) return;
          const msg = interview.messages.find((m) => m.id === aiMsgId);
          if (msg) msg.content = content;
        },
      );
  },
});

export const projectActions = projectSlice.actions;
export default projectSlice.reducer;
