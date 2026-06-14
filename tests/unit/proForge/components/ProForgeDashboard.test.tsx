/**
 * Tests for ProForgeDashboard — ProForge pipeline main view.
 * QNBS-v3: Mocks useProForgeViewContext; exercises start screen, running state, abort, stage navigation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineStage } from '../../../../features/proForge/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartPipeline = vi.fn();
const mockAbortPipeline = vi.fn();
const mockSetActiveView = vi.fn();

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
  startPipeline: mockStartPipeline,
  abortPipeline: mockAbortPipeline,
  submitReview: vi.fn(),
  skipStage: vi.fn(),
  rollbackToStage: vi.fn(),
  setActiveView: mockSetActiveView,
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

// Mock child panels so tests focus on the dashboard itself
vi.mock('../../../../components/proForge/PipelineProgressPanel', () => ({
  PipelineProgressPanel: () => <div data-testid="progress-panel">Progress Panel</div>,
}));
vi.mock('../../../../components/proForge/PipelineReviewPanel', () => ({
  PipelineReviewPanel: () => <div data-testid="review-panel">Review Panel</div>,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ProForgeDashboard } from '../../../../components/proForge/ProForgeDashboard';
import { useProForgeViewContext } from '../../../../contexts/ProForgeViewContext';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProForgeDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProForgeViewContext).mockReturnValue(mockContextBase);
  });

  describe('start screen (no active run)', () => {
    it('renders "Start Pipeline" button when no run is active', () => {
      render(<ProForgeDashboard />);
      expect(screen.getByText('proforge.dashboard.start')).toBeInTheDocument();
    });

    it('shows "No active pipeline" subtitle when no run is active', () => {
      render(<ProForgeDashboard />);
      // t() returns the key in tests; component uses t('proforge.pipeline.noneActive')
      expect(screen.getByText('proforge.pipeline.noneActive')).toBeInTheDocument();
    });

    it('disables Start Pipeline button when isLoading=true', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        isLoading: true,
      });
      render(<ProForgeDashboard />);

      const btn = screen.getByText('proforge.dashboard.starting');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('calls startPipeline when Start Pipeline button is clicked', async () => {
      const user = userEvent.setup();
      render(<ProForgeDashboard />);

      await user.click(screen.getByText('proforge.dashboard.start'));
      expect(mockStartPipeline).toHaveBeenCalledTimes(1);
    });

    it('toggles configuration panel when "Show Configuration" is clicked', async () => {
      const user = userEvent.setup();
      render(<ProForgeDashboard />);

      expect(screen.queryByText('proforge.dashboard.config.genrePreset')).not.toBeInTheDocument();
      await user.click(screen.getByText('proforge.dashboard.showConfig'));
      expect(screen.getByText('proforge.dashboard.config.genrePreset')).toBeInTheDocument();
    });
  });

  describe('active pipeline view', () => {
    const runningRun = {
      id: 'run-1',
      projectId: 'proj-1',
      label: 'My Pipeline Run',
      config: mockContextBase.defaultConfig,
      status: 'running' as const,
      activeStage: 'intake' as const,
      stages: [],
      startedAt: new Date().toISOString(),
      prePipelineSnapshotId: 'snap-1',
      traceLog: [],
    };

    it('shows the current run label in the subtitle', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
      });
      render(<ProForgeDashboard />);

      expect(screen.getByText('My Pipeline Run')).toBeInTheDocument();
    });

    it('renders the Abort button when status is "running"', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
      });
      render(<ProForgeDashboard />);

      expect(screen.getByLabelText('proforge.dashboard.abortAria')).toBeInTheDocument();
    });

    it('calls abortPipeline when Abort button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
      });
      render(<ProForgeDashboard />);

      await user.click(screen.getByLabelText('proforge.dashboard.abortAria'));
      expect(mockAbortPipeline).toHaveBeenCalledTimes(1);
    });

    it('renders PipelineProgressPanel when activeView is "dashboard"', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
        activeView: 'dashboard',
      });
      render(<ProForgeDashboard />);

      expect(screen.getByTestId('progress-panel')).toBeInTheDocument();
    });

    it('renders PipelineReviewPanel when activeView="review" and stage is awaitingReview', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
        activeView: 'review',
        activeStageResult: {
          stage: 'intake',
          status: 'awaitingReview',
          reviewItems: [],
          agentOutput: null,
          metrics: {
            aiCalls: 0,
            tokensConsumed: 0,
            durationMs: 0,
            itemsFound: 0,
            itemsAccepted: 0,
            itemsRejected: 0,
          },
        },
      });
      render(<ProForgeDashboard />);

      expect(screen.getByTestId('review-panel')).toBeInTheDocument();
    });

    it('calls setActiveView("trace") when Trace button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: runningRun,
      });
      render(<ProForgeDashboard />);

      await user.click(screen.getByLabelText('proforge.dashboard.traceAria'));
      expect(mockSetActiveView).toHaveBeenCalledWith('trace');
    });
  });
});
