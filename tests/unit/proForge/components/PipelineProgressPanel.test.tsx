/**
 * Tests for PipelineProgressPanel — live metrics and stage history display.
 * QNBS-v3: Mocks useProForgeViewContext; covers empty state, metrics, stage history, awaiting-review warning.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineStage, StageResult, StageStatus } from '../../../../features/proForge/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockContextBase = {
  t: <T = string>(k: string) => k as unknown as T,
  currentRun: null,
  isLoading: false,
  isRunning: false,
  activeView: 'dashboard' as const,
  activeStageResult: null,
  currentStageReviewItems: [],
  defaultConfig: {
    genrePreset: 'general-fiction',
    selectedStages: ['intake'] as PipelineStage[],
    aiProvider: 'gemini',
    ragMode: 'hybrid' as const,
    maxTokens: 4000,
    creativity: 'Balanced' as const,
    useDuckDb: false,
    autoAcceptThreshold: 0,
    language: 'en',
  },
  startPipeline: vi.fn(),
  abortPipeline: vi.fn(),
  submitReview: vi.fn(),
  skipStage: vi.fn(),
  rollbackToStage: vi.fn(),
  setActiveView: vi.fn(),
  dispatch: vi.fn(),
  proForgeState: {
    currentRun: null,
    runHistory: [],
    isRunning: false,
    isActive: false,
    activeView: 'dashboard' as const,
    defaultConfig: {
      genrePreset: 'general-fiction',
      selectedStages: ['intake'] as PipelineStage[],
      aiProvider: 'gemini',
      ragMode: 'hybrid' as const,
      maxTokens: 4000,
      creativity: 'Balanced' as const,
      useDuckDb: false,
      autoAcceptThreshold: 0,
      language: 'en',
    },
    isLoading: false,
    error: null,
  },
};

vi.mock('../../../../contexts/ProForgeViewContext', () => ({
  useProForgeViewContext: vi.fn(() => mockContextBase),
}));

vi.mock('../../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { PipelineProgressPanel } from '../../../../components/proForge/PipelineProgressPanel';
import { useProForgeViewContext } from '../../../../contexts/ProForgeViewContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStage = (
  stage: PipelineStage,
  status: StageStatus,
  metrics: {
    aiCalls: number;
    tokensConsumed: number;
    durationMs: number;
    itemsFound: number;
    itemsAccepted: number;
    itemsRejected: number;
  },
): StageResult => ({ stage, status, metrics, reviewItems: [], agentOutput: null });

const baseRun = {
  id: 'run-1',
  projectId: 'proj-1',
  label: 'Test Run',
  config: mockContextBase.defaultConfig,
  status: 'running' as const,
  activeStage: 'intake' as const,
  stages: [],
  startedAt: new Date().toISOString(),
  prePipelineSnapshotId: 'snap-1',
  traceLog: [],
};

const defaultMetrics = {
  aiCalls: 0,
  tokensConsumed: 0,
  durationMs: 0,
  itemsFound: 0,
  itemsAccepted: 0,
  itemsRejected: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineProgressPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProForgeViewContext).mockReturnValue(mockContextBase);
  });

  describe('empty state (no currentRun)', () => {
    it('shows "No pipeline running." message', () => {
      render(<PipelineProgressPanel />);
      expect(screen.getByText('No pipeline running.')).toBeInTheDocument();
    });
  });

  describe('with active run', () => {
    it('renders Current Status section with activeStage', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, activeStage: 'structural' as const },
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('Current Status')).toBeInTheDocument();
      expect(screen.getByText('structural')).toBeInTheDocument();
    });

    it('renders the run status', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, status: 'running' },
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('running')).toBeInTheDocument();
    });

    it('shows stage-specific loading message when isLoading=true', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: baseRun, // activeStage: 'intake'
        isLoading: true,
      });
      render(<PipelineProgressPanel />);

      // t() returns the key; 'intake' stage → 'proforge.loading.intake'
      expect(screen.getByText('proforge.loading.intake')).toBeInTheDocument();
    });

    it('does not show loading message when isLoading=false', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: baseRun,
        isLoading: false,
      });
      render(<PipelineProgressPanel />);

      expect(screen.queryByText('proforge.loading.intake')).not.toBeInTheDocument();
    });

    it('renders Stage Details section when activeStageResult is set', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: baseRun,
        activeStageResult: makeStage('intake', 'running', {
          ...defaultMetrics,
          aiCalls: 5,
          tokensConsumed: 1500,
          durationMs: 3200,
          itemsFound: 12,
        }),
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('Stage Details: intake')).toBeInTheDocument();
      // AI Calls metric
      expect(screen.getByText('5')).toBeInTheDocument();
      // Tokens — toLocaleString output differs by Node ICU build; accept both
      expect(screen.getByText(/^1[,.]?500$/)).toBeInTheDocument();
      expect(screen.getByText('3.2s')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('shows awaiting-review warning when stage status is awaitingReview', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: baseRun,
        activeStageResult: makeStage('intake', 'awaitingReview', defaultMetrics),
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText(/This stage is awaiting your review/)).toBeInTheDocument();
    });

    it('does not show awaiting-review warning when stage is running', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: baseRun,
        activeStageResult: makeStage('intake', 'running', defaultMetrics),
      });
      render(<PipelineProgressPanel />);

      expect(screen.queryByText(/awaiting your review/)).not.toBeInTheDocument();
    });
  });

  describe('Pipeline Totals', () => {
    it('renders aggregated metrics from all completed stages', () => {
      const stages = [
        makeStage('intake', 'accepted', {
          aiCalls: 3,
          tokensConsumed: 1000,
          durationMs: 2000,
          itemsFound: 5,
          itemsAccepted: 5,
          itemsRejected: 0,
        }),
        makeStage('structural', 'accepted', {
          aiCalls: 7,
          tokensConsumed: 2000,
          durationMs: 5000,
          itemsFound: 10,
          itemsAccepted: 8,
          itemsRejected: 2,
        }),
      ];
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, stages },
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('Pipeline Totals')).toBeInTheDocument();
      // Total AI Calls: 3 + 7 = 10
      expect(screen.getByText('10')).toBeInTheDocument();
      // Total Tokens: 1000 + 2000 = 3000 — toLocaleString varies by ICU build
      expect(screen.getByText(/^3[,.]?000$/)).toBeInTheDocument();
      // Total Time: (2000 + 5000) / 1000 = 7.0s
      expect(screen.getByText('7.0s')).toBeInTheDocument();
    });

    it('renders Pipeline Totals with zero values when stages array is empty', () => {
      // QNBS-v3: component renders totals section whenever currentRun is set, even with 0 stages
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, stages: [] },
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('Pipeline Totals')).toBeInTheDocument();
    });
  });

  describe('Stage History', () => {
    it('renders completed stages list', () => {
      const stages = [
        makeStage('intake', 'accepted', defaultMetrics),
        makeStage('structural', 'skipped', defaultMetrics),
      ];
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, stages },
      });
      render(<PipelineProgressPanel />);

      expect(screen.getByText('Completed Stages')).toBeInTheDocument();
      // "intake" appears as both Active Stage value and in stage history — use getAllByText
      expect(screen.getAllByText('intake').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('structural')).toBeInTheDocument();
      expect(screen.getByText('accepted')).toBeInTheDocument();
      expect(screen.getByText('skipped')).toBeInTheDocument();
    });

    it('does not render Stage History section when stages array is empty', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: { ...baseRun, stages: [] },
      });
      render(<PipelineProgressPanel />);

      expect(screen.queryByText('Completed Stages')).not.toBeInTheDocument();
    });
  });
});
