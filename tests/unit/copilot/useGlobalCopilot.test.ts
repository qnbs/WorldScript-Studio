import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: controllable copilot state + dispatch/stop spies. The real copilotSlice action creators
// run (so dispatched actions carry real types); only the React/AI/service surface is mocked.
const { mockDispatch, mockStop, state } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockStop: vi.fn(),
  state: {
    copilot: {
      isOpen: true,
      status: 'streaming' as 'idle' | 'streaming' | 'error',
      error: null as string | null,
      messages: [
        { id: 'a1', role: 'assistant', content: 'partial…', pending: true, createdAt: '' },
      ],
    },
  },
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) => selector(state),
}));
// QNBS-v3: mock transientUiStore — copilot overlay state now lives in Zustand, not Redux
vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (selector: (s: unknown) => unknown) =>
    selector({
      copilotInsights: [],
      copilotHeuristicsOnly: false,
      copilotInsightStatus: 'idle' as const,
      setCopilotInsights: vi.fn(),
      setCopilotHeuristicsOnly: vi.fn(),
      setCopilotInsightStatus: vi.fn(),
      // QNBS-v3: Phase 2 additions
      activeSectionId: null,
      setActiveSectionId: vi.fn(),
      // QNBS-v3: CodeAnt fix — badge-to-insights-expand bridge
      copilotInsightExpanded: false,
      setCopilotInsightExpanded: vi.fn(),
    }),
}));
vi.mock('../../../hooks/useStoryCraftAI', () => ({
  useStoryCraftAI: () => ({ runCompletion: vi.fn(), stop: mockStop, isLoading: false }),
}));
vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../../contexts/CommandExecutorContext', () => ({
  useCommandExecutor: () => vi.fn(),
}));
vi.mock('../../../features/project/projectSelectors', () => ({ selectProjectData: () => null }));
vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableProForge: () => false,
}));
vi.mock('../../../services/commands/wordCountApprox', () => ({
  approximateManuscriptWordCount: () => 0,
}));
vi.mock('../../../services/copilot/copilotActions', () => ({
  detectCopilotIntent: () => 'chat',
  runCopilotDiagnostic: vi.fn(),
}));
vi.mock('../../../services/copilot/copilotContextService', () => ({
  assembleCopilotPrompt: () => 'prompt',
  buildSystemPrompt: () => 'system',
}));
vi.mock('../../../services/proForge/adapters/browserProForgeCapability', () => ({
  createBrowserProForgeCapability: vi.fn(),
}));
vi.mock('../../../services/viewNavigationLabels', () => ({
  viewNavigationLabelKey: () => 'nav.writer',
}));
// QNBS-v3: mock insight generator so scheduleInsightGeneration doesn't fire timers in tests.
vi.mock('../../../services/copilot/insightGenerator', () => ({
  scheduleInsightGeneration: vi.fn(),
  cancelInsightGeneration: vi.fn(),
}));

import { useGlobalCopilot } from '../../../hooks/useGlobalCopilot';

beforeEach(() => {
  mockDispatch.mockClear();
  mockStop.mockClear();
  state.copilot.status = 'streaming';
});

describe('useGlobalCopilot.close (CodeAnt #7)', () => {
  it('resets a stuck streaming status to idle so future sends are not blocked', () => {
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.close());

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/finishLastAssistant' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/setStatus', payload: 'idle' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/setOpen', payload: false }),
    );
  });

  it('does not touch status when not streaming', () => {
    state.copilot.status = 'idle';
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.close());

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/setOpen', payload: false }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/setStatus' }),
    );
  });
});
