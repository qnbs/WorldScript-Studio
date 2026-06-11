/**
 * Copilot slice — ephemeral runtime state for the Global AI Copilot live assistant.
 * QNBS-v3: NOT undo-wrapped, NOT persisted (local-first, in-memory only). Root key `copilot`.
 * Chat history, proactive insights, and heuristics-only mode live here.
 * Orchestration is in hooks/useGlobalCopilot.ts; insight generation in services/copilot/insightGenerator.ts.
 */

import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import type { HeuristicFinding } from '../../services/copilot/heuristicEngine';

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

export type InsightStatus = 'idle' | 'running';

export interface CopilotState {
  isOpen: boolean;
  messages: CopilotMessage[];
  status: CopilotStatus;
  error: string | null;
  /** Proactive heuristic findings surfaced in the Insight panel above suggestions. */
  proactiveInsights: HeuristicFinding[];
  /** When true the Copilot skips all AI calls and replies from heuristics only. */
  heuristicsOnly: boolean;
  /** Tracks whether the insight generator is running. */
  insightStatus: InsightStatus;
}

const initialState: CopilotState = {
  isOpen: false,
  messages: [],
  status: 'idle',
  error: null,
  proactiveInsights: [],
  heuristicsOnly: false,
  insightStatus: 'idle',
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
    clear(state) {
      state.messages = [];
      state.status = 'idle';
      state.error = null;
      state.proactiveInsights = [];
      state.insightStatus = 'idle';
    },
    setProactiveInsights(state, action: PayloadAction<HeuristicFinding[]>) {
      state.proactiveInsights = action.payload;
    },
    setInsightStatus(state, action: PayloadAction<InsightStatus>) {
      state.insightStatus = action.payload;
    },
    setHeuristicsOnly(state, action: PayloadAction<boolean>) {
      state.heuristicsOnly = action.payload;
    },
  },
});

export const copilotActions = copilotSlice.actions;

export const selectCopilotIsOpen = (s: { copilot: CopilotState }) => s.copilot.isOpen;
export const selectCopilotMessages = (s: { copilot: CopilotState }) => s.copilot.messages;
export const selectCopilotStatus = (s: { copilot: CopilotState }) => s.copilot.status;
export const selectCopilotError = (s: { copilot: CopilotState }) => s.copilot.error;
export const selectCopilotProactiveInsights = (s: { copilot: CopilotState }) =>
  s.copilot.proactiveInsights;
export const selectCopilotHeuristicsOnly = (s: { copilot: CopilotState }) =>
  s.copilot.heuristicsOnly;
export const selectCopilotInsightStatus = (s: { copilot: CopilotState }) => s.copilot.insightStatus;

export default copilotSlice.reducer;
