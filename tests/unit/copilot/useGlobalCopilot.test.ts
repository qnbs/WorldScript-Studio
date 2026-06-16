import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: controllable copilot state + dispatch/stop spies. The real copilotSlice action creators
// run (so dispatched actions carry real types); only the React/AI/service surface is mocked.
const { mockDispatch, mockStop, state, aiOptions } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockStop: vi.fn(),
  // QNBS-v3 (Batch 1.2): capture the options the hook passes to useWorldScriptAI so tests can
  // invoke its onError callback.
  aiOptions: { current: null as null | { onError?: (err: Error) => void } },
  state: {
    copilot: {
      isOpen: true,
      status: 'streaming' as 'idle' | 'streaming' | 'error',
      error: null as string | null,
      messages: [
        { id: 'a1', role: 'assistant', content: 'partial…', pending: true, createdAt: '' },
      ],
    },
    activeSectionId: null as string | null,
    project: null as {
      id: string;
      title: string;
      manuscript: Array<{ id: string; title?: string; content?: string }>;
    } | null,
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
      activeSectionId: state.activeSectionId,
      setActiveSectionId: vi.fn(),
      // QNBS-v3: CodeAnt fix — badge-to-insights-expand bridge
      copilotInsightExpanded: false,
      setCopilotInsightExpanded: vi.fn(),
    }),
}));
vi.mock('../../../hooks/useWorldScriptAI', () => ({
  useWorldScriptAI: (opts: { onError?: (err: Error) => void }) => {
    aiOptions.current = opts;
    return { runCompletion: vi.fn(), stop: mockStop, isLoading: false };
  },
}));
vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../../contexts/CommandExecutorContext', () => ({
  useCommandExecutor: () => vi.fn(),
}));
vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: () => state.project,
}));
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
  // QNBS-v3: reset captured AI options so each test starts from clean shared state.
  aiOptions.current = null;
  state.copilot.status = 'streaming';
  state.project = null;
  state.activeSectionId = null;
  vi.useRealTimers();
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

describe('useGlobalCopilot.applyLastSuggestion', () => {
  function setupProject(content: string, activeId: string | null = 's1') {
    state.project = {
      id: 'p1',
      title: 'Test Project',
      manuscript: [
        { id: 's1', title: 'Chapter 1', content },
        { id: 's2', title: 'Chapter 2', content: 'Other chapter content.' },
      ],
    };
    state.activeSectionId = activeId;
  }

  it('does nothing when there is no active section id', () => {
    setupProject('Existing content', null);
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion('replacement'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/updateManuscriptSection' }),
    );
  });

  it('does nothing when the active section is not found', () => {
    setupProject('Existing content', 'missing');
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion('replacement'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/updateManuscriptSection' }),
    );
  });

  it('rejects a block shorter than 70% of the existing content', () => {
    setupProject('This is a fairly long piece of existing chapter content.');
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion('short'));
    expect(result.current.applyStatus).toBe('error');
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/updateManuscriptSection' }),
    );
  });

  it('accepts a rewrite of an empty section regardless of length', () => {
    setupProject('');
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion('New scene text'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateManuscriptSection',
        payload: expect.objectContaining({ id: 's1', changes: { content: 'New scene text' } }),
      }),
    );
  });

  it('accepts a block that is at least 70% of the existing content and dispatches an update', () => {
    const existing =
      'This is the original chapter text that we want to replace with a full rewrite.';
    setupProject(existing);
    const replacement =
      'This is the rewritten chapter text that is clearly a full rewrite of the scene.';
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion(replacement));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateManuscriptSection',
        payload: expect.objectContaining({ id: 's1', changes: { content: replacement } }),
      }),
    );
  });

  it('cycles applyStatus through applying -> success -> idle', async () => {
    vi.useFakeTimers();
    setupProject('Old content');
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() =>
      result.current.applyLastSuggestion(
        'Completely rewritten chapter content that is much longer than the original text so it passes the gate.',
      ),
    );
    expect(result.current.applyStatus).toBe('success');
    act(() => vi.advanceTimersByTime(3000));
    await vi.waitFor(() => expect(result.current.applyStatus).toBe('idle'));
  });

  it('cycles applyStatus through applying -> error -> idle when the block is too short', async () => {
    vi.useFakeTimers();
    setupProject('This is a fairly long piece of existing chapter content.');
    const { result } = renderHook(() => useGlobalCopilot('writer' as never));
    act(() => result.current.applyLastSuggestion('short'));
    expect(result.current.applyStatus).toBe('error');
    act(() => vi.advanceTimersByTime(3000));
    await vi.waitFor(() => expect(result.current.applyStatus).toBe('idle'));
  });
});

describe('useGlobalCopilot onError (Batch 1.2)', () => {
  // QNBS-v3: the translation mock returns the key, so the dispatched content is the resolved
  // `error.ai.*` key — proving the classified message replaces the generic copilot.error.
  it('shows the classified auth message on a 401, not the generic error', () => {
    renderHook(() => useGlobalCopilot('writer' as never));
    const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
    act(() => aiOptions.current?.onError?.(authErr));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'copilot/setLastAssistantContent',
        payload: 'error.ai.auth',
      }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'copilot/setLastAssistantContent',
        payload: 'copilot.error',
      }),
    );
  });

  it('classifies a policy block as error.ai.policy', () => {
    renderHook(() => useGlobalCopilot('writer' as never));
    act(() =>
      aiOptions.current?.onError?.(new Error('Cloud provider blocked: local-only mode is active.')),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'copilot/setLastAssistantContent',
        payload: 'error.ai.policy',
      }),
    );
  });
});
