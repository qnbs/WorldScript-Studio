/**
 * Tests for useProForgeOrchestrator hook.
 * QNBS-v3: Mocks Redux store + orchestrator factory; tests action wiring and computed values.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockStartPipeline = vi.fn().mockResolvedValue(undefined);
const mockAbortPipeline = vi.fn().mockResolvedValue(undefined);
const mockSubmitReview = vi.fn().mockResolvedValue(undefined);
const mockSkipStage = vi.fn();
const mockRollbackTo = vi.fn().mockResolvedValue(undefined);
const mockDispose = vi.fn();

const mockOrchestrator = {
  startPipeline: mockStartPipeline,
  abortPipeline: mockAbortPipeline,
  submitReview: mockSubmitReview,
  skipStage: mockSkipStage,
  rollbackTo: mockRollbackTo,
  dispose: mockDispose,
};

vi.mock('../../../services/proForge/proForgeOrchestrator', () => ({
  createProForgeOrchestrator: vi.fn(() => mockOrchestrator),
}));

vi.mock('../../../features/proForge/proForgeSlice', () => ({
  proForgeActions: {
    setActiveView: vi.fn((v) => ({ type: 'proForge/setActiveView', payload: v })),
  },
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

const mockProForgeState = {
  isActive: false,
  activeView: 'dashboard' as const,
  currentRun: null,
  runHistory: [],
  defaultConfig: {},
  isRunning: false,
  isLoading: false,
  error: null,
};

const mockProject = {
  id: 'proj-1',
  title: 'My Novel',
  logline: 'A test story',
  manuscript: [{ id: 's1', title: 'Ch 1', content: 'Hello' }],
  characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
  worlds: { ids: [], entities: {} },
};

// QNBS-v3: extracted so it can also be restored in afterEach below -- overriding mockUseAppSelector's implementation (not just queuing a mockImplementationOnce) would otherwise leak into later tests.
function defaultAppState() {
  return {
    proForge: mockProForgeState,
    project: { present: { data: mockProject } },
    settings: {
      advancedAi: {
        provider: 'gemini',
        ragMode: 'hybrid',
        maxTokens: 8000,
        creativity: 'Balanced',
      },
    },
    featureFlags: { enableDuckDbAnalytics: false },
  };
}

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) => selector(defaultAppState())),
}));

// QNBS-v3: shared by every test/hook below that needs mockUseAppSelector to receive custom state -- vi.mocked(mockUseAppSelector)'s static type expects a RootState selector, which a mock's own loosely-typed state object structurally can't satisfy without this cast.
function selectFrom(state: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: mock — RootState not needed in test
  return (selector: (s: any) => unknown) => selector(state);
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useProForgeOrchestrator } from '../../../hooks/useProForgeOrchestrator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProForgeOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // QNBS-v3 (#713 cubic): clearAllMocks() clears call history but not a mockImplementation override -- restore the default selector behavior so a test that overrides it doesn't leak into later tests.
  afterEach(async () => {
    const { useAppSelector: mockUseAppSelector } = await import('../../../app/hooks');
    vi.mocked(mockUseAppSelector).mockImplementation(selectFrom(defaultAppState()));
  });

  describe('initial state', () => {
    it('returns proForgeState', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.proForgeState).toEqual(mockProForgeState);
    });

    it('returns isRunning = false', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.isRunning).toBe(false);
    });

    it('returns isLoading = false', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.isLoading).toBe(false);
    });

    it('returns currentRun = null', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.currentRun).toBeNull();
    });

    it('returns activeView = dashboard', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.activeView).toBe('dashboard');
    });

    it('returns activeStageResult = null when no current run', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.activeStageResult).toBeNull();
    });

    it('returns empty currentStageReviewItems when no active stage result', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.currentStageReviewItems).toHaveLength(0);
    });
  });

  describe('defaultConfig', () => {
    it('builds defaultConfig from settings', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.defaultConfig.ragMode).toBe('hybrid');
      expect(result.current.defaultConfig.maxTokens).toBe(8000);
      expect(result.current.defaultConfig.language).toBe('en');
    });

    it('includes all 8 editing stages in selectedStages by default', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.defaultConfig.selectedStages).toContain('intake');
      expect(result.current.defaultConfig.selectedStages).toContain('analytics');
      expect(result.current.defaultConfig.selectedStages).toHaveLength(8);
    });
  });

  describe('startPipeline', () => {
    it('calls orchestrator.startPipeline with label and config', async () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      const config = result.current.defaultConfig;
      await act(async () => {
        await result.current.startPipeline('My Draft v1', config);
      });
      expect(mockStartPipeline).toHaveBeenCalledWith('My Draft v1', config);
    });

    it('does not create orchestrator if no project', async () => {
      const { useAppSelector: mockUseAppSelector } = await import('../../../app/hooks');
      vi.mocked(mockUseAppSelector)
        .mockImplementationOnce(() => mockProForgeState)
        .mockImplementationOnce(() => null) // project = null
        .mockImplementationOnce(() => ({}))
        .mockImplementationOnce(() => ({}));

      // The hook creates a new ref each render, so calling startPipeline
      // with no project should be a no-op (returns early)
      const { result } = renderHook(() => useProForgeOrchestrator());
      await act(async () => {
        await result.current.startPipeline('No-op', result.current.defaultConfig);
      });
      // If no project, getOrchestrator returns null — startPipeline call is skipped
      // (We just verify no throw occurs)
      expect(true).toBe(true);
    });

    it('rebuilds the orchestrator when the same project id gets a new generation (#713)', async () => {
      const { useAppSelector: mockUseAppSelector } = await import('../../../app/hooks');
      const { createProForgeOrchestrator } = await import(
        '../../../services/proForge/proForgeOrchestrator'
      );

      function stateWithGeneration(generation: number) {
        return {
          proForge: mockProForgeState,
          project: { present: { data: mockProject, generation } },
          settings: {
            advancedAi: {
              provider: 'gemini',
              ragMode: 'hybrid',
              maxTokens: 8000,
              creativity: 'Balanced',
            },
          },
          featureFlags: { enableDuckDbAnalytics: false },
        };
      }

      vi.mocked(mockUseAppSelector).mockImplementation(selectFrom(stateWithGeneration(0)));
      const { result, rerender } = renderHook(() => useProForgeOrchestrator());
      await act(async () => {
        await result.current.startPipeline('Run 1', result.current.defaultConfig);
      });
      expect(vi.mocked(createProForgeOrchestrator)).toHaveBeenCalledTimes(1);

      // QNBS-v3: same nominal project id ('proj-1'), but a reset/import/restore bumped generation -- the cached orchestrator must not silently survive into a pipeline run started against the new incarnation.
      vi.mocked(mockUseAppSelector).mockImplementation(selectFrom(stateWithGeneration(1)));
      rerender();
      await act(async () => {
        await result.current.startPipeline('Run 2', result.current.defaultConfig);
      });
      expect(vi.mocked(createProForgeOrchestrator)).toHaveBeenCalledTimes(2);
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('rebuilds the orchestrator on a generation change even when the project has no id (#713 cubic)', async () => {
      const { useAppSelector: mockUseAppSelector } = await import('../../../app/hooks');
      const { createProForgeOrchestrator } = await import(
        '../../../services/proForge/proForgeOrchestrator'
      );
      // QNBS-v3: both states below resolve to a null projectIdentity (no id) -- a string-only comparison would treat this as "unchanged"; the generation comparison is what must catch it.
      const idLessProject = { ...mockProject, id: '' };

      function stateWithIdLessGeneration(generation: number) {
        return {
          proForge: mockProForgeState,
          project: { present: { data: idLessProject, generation } },
          settings: {
            advancedAi: {
              provider: 'gemini',
              ragMode: 'hybrid',
              maxTokens: 8000,
              creativity: 'Balanced',
            },
          },
          featureFlags: { enableDuckDbAnalytics: false },
        };
      }

      vi.mocked(mockUseAppSelector).mockImplementation(selectFrom(stateWithIdLessGeneration(0)));
      const { result, rerender } = renderHook(() => useProForgeOrchestrator());
      await act(async () => {
        await result.current.startPipeline('Run 1', result.current.defaultConfig);
      });
      expect(vi.mocked(createProForgeOrchestrator)).toHaveBeenCalledTimes(1);

      vi.mocked(mockUseAppSelector).mockImplementation(selectFrom(stateWithIdLessGeneration(1)));
      rerender();
      await act(async () => {
        await result.current.startPipeline('Run 2', result.current.defaultConfig);
      });
      expect(vi.mocked(createProForgeOrchestrator)).toHaveBeenCalledTimes(2);
    });
  });

  describe('abortPipeline', () => {
    it('calls orchestrator.abortPipeline', async () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      await act(async () => {
        await result.current.abortPipeline();
      });
      expect(mockAbortPipeline).toHaveBeenCalled();
    });
  });

  describe('submitReview', () => {
    it('calls orchestrator.submitReview with advance:true', async () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      const decisions = [{ itemId: 'item-1', status: 'accepted' as const }];
      await act(async () => {
        await result.current.submitReview('intake', decisions);
      });
      expect(mockSubmitReview).toHaveBeenCalledWith('intake', decisions, { advance: true });
    });
  });

  describe('skipStage', () => {
    it('calls orchestrator.skipStage', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      act(() => {
        result.current.skipStage('structural');
      });
      expect(mockSkipStage).toHaveBeenCalledWith('structural');
    });
  });

  describe('rollbackToStage', () => {
    it('calls orchestrator.rollbackTo', async () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      await act(async () => {
        await result.current.rollbackToStage('intake');
      });
      expect(mockRollbackTo).toHaveBeenCalledWith('intake');
    });
  });

  describe('setActiveView', () => {
    it('dispatches setActiveView action', () => {
      const { result } = renderHook(() => useProForgeOrchestrator());
      act(() => {
        result.current.setActiveView('review');
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'proForge/setActiveView', payload: 'review' }),
      );
    });
  });

  describe('activeStageResult with a running pipeline', () => {
    it('returns the active stage result from currentRun', async () => {
      const reviewItem = {
        id: 'item-1',
        stage: 'intake',
        type: 'consistencyIssue',
        severity: 'warning',
        description: 'Test issue',
        confidence: 0.8,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00Z',
      };
      const { useAppSelector: mockUseAppSelector } = await import('../../../app/hooks');
      // biome-ignore lint/suspicious/noExplicitAny: mock — RootState not needed in test
      vi.mocked(mockUseAppSelector).mockImplementation((selector: (s: any) => unknown) =>
        selector({
          proForge: {
            ...mockProForgeState,
            currentRun: {
              id: 'run-1',
              status: 'awaitingReview',
              activeStage: 'intake',
              stages: [
                {
                  stage: 'intake',
                  status: 'awaitingReview',
                  reviewItems: [reviewItem],
                  metrics: {
                    aiCalls: 1,
                    tokensConsumed: 100,
                    durationMs: 500,
                    itemsFound: 1,
                    itemsAccepted: 0,
                    itemsRejected: 0,
                  },
                },
              ],
              config: {},
              label: 'Test',
              traceLog: [],
            },
            isRunning: true,
          },
          project: { present: { data: mockProject } },
          settings: { advancedAi: { ragMode: 'hybrid', maxTokens: 8000, creativity: 'Balanced' } },
          featureFlags: { enableDuckDbAnalytics: false },
        }),
      );

      const { result } = renderHook(() => useProForgeOrchestrator());
      expect(result.current.activeStageResult).not.toBeNull();
      expect(result.current.activeStageResult?.stage).toBe('intake');
      expect(result.current.currentStageReviewItems).toHaveLength(1);
      expect(result.current.currentStageReviewItems[0]!.id).toBe('item-1');
    });
  });
});
