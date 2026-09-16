/**
 * Copilot slice — ephemeral runtime state for the Global AI Copilot live assistant.
 * QNBS-v3: NOT undo-wrapped, NOT persisted (local-first, in-memory only). Root key `copilot`.
 * Chat history and streaming status live here. Proactive insights, heuristicsOnly, and
 * insightStatus are panel-only overlay state → transientUiStore (Zustand).
 * Orchestration is in hooks/useGlobalCopilot.ts; insight generation in services/copilot/insightGenerator.ts.
 */

import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type CopilotRole = 'user' | 'assistant' | 'system';
export type CopilotStatus = 'idle' | 'streaming' | 'error';

export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  createdAt: string;
  /** True while an assistant message is still streaming. */
  pending?: boolean;
}

export interface CopilotState {
  isOpen: boolean;
  messages: CopilotMessage[];
  status: CopilotStatus;
  error: string | null;
  // QNBS-v3 (#713): the project incarnation the most recent sendMessage() targets -- this state is global Redux (unlike Manuscript view's local hook state), so it survives an unmount/remount and applyLastSuggestion must verify against it before writing into the manuscript.
  generatedForProjectIdentity: string | null;
}

const initialState: CopilotState = {
  isOpen: false,
  messages: [],
  status: 'idle',
  error: null,
  generatedForProjectIdentity: null,
};

const copilotSlice = createSlice({
  name: 'copilot',
  initialState,
  reducers: {
    setOpen(state, action: PayloadAction<boolean>) {
      state.isOpen = action.payload;
    },
    toggle(state) {
      state.isOpen = !state.isOpen;
    },
    addMessage: {
      reducer(state, action: PayloadAction<CopilotMessage>) {
        state.messages.push(action.payload);
      },
      prepare(role: CopilotRole, content: string, pending = false) {
        return {
          payload: {
            id: nanoid(),
            role,
            content,
            createdAt: new Date().toISOString(),
            ...(pending && { pending }),
          } satisfies CopilotMessage,
        };
      },
    },
    /** Replace the content of the most recent assistant message (streaming sync). */
    setLastAssistantContent(state, action: PayloadAction<string>) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (msg && msg.role === 'assistant') {
          msg.content = action.payload;
          break;
        }
      }
    },
    /** Mark the most recent assistant message as no longer pending. */
    finishLastAssistant(state) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (msg && msg.role === 'assistant') {
          delete msg.pending;
          break;
        }
      }
    },
    setStatus(state, action: PayloadAction<CopilotStatus>) {
      state.status = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      if (action.payload) state.status = 'error';
    },
    // QNBS-v3 (#713): captured at sendMessage() time, checked by applyLastSuggestion later since the async response may outlive a project switch.
    setGeneratedForProjectIdentity(state, action: PayloadAction<string | null>) {
      state.generatedForProjectIdentity = action.payload;
    },
    clear(state) {
      state.messages = [];
      state.status = 'idle';
      state.error = null;
      state.generatedForProjectIdentity = null;
      // QNBS-v3: copilotInsights + copilotInsightStatus reset via transientUiStore in useGlobalCopilot
    },
    // QNBS-v3 (#713): this slice is global Redux (unlike Manuscript view's local hook state), so it survives an unmount/remount -- a project switch must invalidate it explicitly rather than relying on the component's own lifecycle.
    invalidateForProjectChange(state) {
      state.messages = [];
      state.status = 'idle';
      state.error = null;
      state.generatedForProjectIdentity = null;
    },
  },
});

export const copilotActions = copilotSlice.actions;

export const selectCopilotIsOpen = (s: { copilot: CopilotState }) => s.copilot.isOpen;
export const selectCopilotMessages = (s: { copilot: CopilotState }) => s.copilot.messages;
export const selectCopilotStatus = (s: { copilot: CopilotState }) => s.copilot.status;
export const selectCopilotError = (s: { copilot: CopilotState }) => s.copilot.error;
export const selectCopilotGeneratedForProjectIdentity = (s: { copilot: CopilotState }) =>
  s.copilot.generatedForProjectIdentity;

export default copilotSlice.reducer;
