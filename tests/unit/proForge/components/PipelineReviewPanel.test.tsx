/**
 * Tests for PipelineReviewPanel — Human-in-the-Loop review + approve/reject interface.
 * QNBS-v3: Mocks useProForgeViewContext + proForgeSlice; exercises filter tabs, item actions, batch ops, submit/skip.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PipelineStage,
  ReviewItemSeverity,
  ReviewItemType,
  StageStatus,
} from '../../../../features/proForge/types';
// QNBS-v3: Real English strings so assertions read naturally; t() resolves keys + {{vars}}.
import mockEnCommon from '../../../../locales/en/common.json';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSubmitReview = vi.fn();
const mockSkipStage = vi.fn();
const mockSetActiveView = vi.fn();

const makeItem = (
  id: string,
  status: 'pending' | 'accepted' | 'rejected' | 'ignored' = 'pending',
  overrides: Partial<{
    type: string;
    severity: string;
    description: string;
    confidence: number;
    sectionTitle: string;
    original: string;
    proposed: string;
    rationale: string;
  }> = {},
) => ({
  id,
  type: (overrides.type ?? 'grammarEdit') as ReviewItemType,
  severity: (overrides.severity ?? 'warning') as ReviewItemSeverity,
  description: overrides.description ?? `Issue ${id}`,
  confidence: overrides.confidence ?? 0.9,
  status,
  stage: 'intake' as PipelineStage,
  createdAt: new Date().toISOString(),
  sectionTitle: overrides.sectionTitle ?? '',
  original: overrides.original ?? '',
  proposed: overrides.proposed ?? '',
  rationale: overrides.rationale ?? '',
});

const mockContextBase = {
  t: <T = string>(k: string) => k as unknown as T,
  currentRun: {
    id: 'run-1',
    projectId: 'proj-1',
    label: 'Test Run',
    status: 'running' as const,
    activeStage: 'intake' as const,
    stages: [],
    startedAt: new Date().toISOString(),
    prePipelineSnapshotId: 'snap-1',
    traceLog: [],
    config: {
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
  },
  isLoading: false,
  isRunning: true,
  activeView: 'review' as const,
  activeStageResult: {
    stage: 'intake' as PipelineStage,
    status: 'awaitingReview' as StageStatus,
    reviewItems: [makeItem('item-1'), makeItem('item-2', 'accepted')],
    agentOutput: null,
    metrics: {
      aiCalls: 2,
      tokensConsumed: 800,
      durationMs: 1200,
      itemsFound: 2,
      itemsAccepted: 0,
      itemsRejected: 0,
    },
  },
  currentStageReviewItems: [makeItem('item-1'), makeItem('item-2', 'accepted')],
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
  submitReview: mockSubmitReview,
  skipStage: mockSkipStage,
  rollbackToStage: vi.fn(),
  setActiveView: mockSetActiveView,
  dispatch: mockDispatch,
  proForgeState: {
    currentRun: null,
    runHistory: [],
    isRunning: false,
    isActive: false,
    activeView: 'review' as const,
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

vi.mock('../../../../features/proForge/proForgeSlice', () => ({
  proForgeActions: {
    setReviewItemStatus: vi.fn((payload) => ({ type: 'proForge/setReviewItemStatus', payload })),
    acceptAllReviewItems: vi.fn((payload) => ({ type: 'proForge/acceptAllReviewItems', payload })),
    rejectAllReviewItems: vi.fn((payload) => ({ type: 'proForge/rejectAllReviewItems', payload })),
  },
}));

vi.mock('../../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict = mockEnCommon as Record<string, string>;
      let s = dict[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replace(`{{${k}}}`, String(v));
      }
      return s;
    },
    language: 'en',
  }),
}));

vi.mock('../../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => vi.fn(),
}));

// QNBS-v3: PipelineReviewPanel calls useAppDispatch/useAppSelector directly for copilot flag — mock hooks to avoid Redux Provider
vi.mock('../../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: vi.fn(() => false),
  useAppSelectorShallow: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { PipelineReviewPanel } from '../../../../components/proForge/PipelineReviewPanel';
import { useProForgeViewContext } from '../../../../contexts/ProForgeViewContext';
import { proForgeActions } from '../../../../features/proForge/proForgeSlice';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProForgeViewContext).mockReturnValue(mockContextBase);
  });

  describe('empty state (no currentRun)', () => {
    it('renders "No review items available." when currentRun is null', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentRun: null,
        activeStageResult: null,
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText('No review items available.')).toBeInTheDocument();
    });

    it('renders empty state when activeStageResult has no stage', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        activeStageResult: {
          ...mockContextBase.activeStageResult,
          stage: null as unknown as PipelineStage,
        },
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText('No review items available.')).toBeInTheDocument();
    });
  });

  describe('header', () => {
    it('shows stage name in header', () => {
      render(<PipelineReviewPanel />);
      // Stage id 'intake' is localised to its display name in the header.
      expect(screen.getByText(/Review: Intake/i)).toBeInTheDocument();
    });

    it('shows correct pending/accepted/rejected counts', () => {
      render(<PipelineReviewPanel />);
      // 1 pending, 1 accepted, 0 rejected
      expect(screen.getByText(/1 pending/)).toBeInTheDocument();
      expect(screen.getByText(/1 accepted/)).toBeInTheDocument();
      expect(screen.getByText(/0 rejected/)).toBeInTheDocument();
    });
  });

  describe('filter tabs', () => {
    it('renders all filter buttons', () => {
      render(<PipelineReviewPanel />);
      expect(screen.getByText(/^all/i)).toBeInTheDocument();
      expect(screen.getByText(/^pending/i)).toBeInTheDocument();
      expect(screen.getByText(/^accepted/i)).toBeInTheDocument();
      expect(screen.getByText(/^rejected/i)).toBeInTheDocument();
    });

    it('filters to pending items when "pending" tab is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('item-1', 'pending', { description: 'Grammar error here' }),
          makeItem('item-2', 'accepted', { description: 'Style suggestion here' }),
        ],
      });
      render(<PipelineReviewPanel />);

      // Use role query to avoid matching the header "1 pending" text
      const pendingTab = screen
        .getAllByRole('button')
        .find((b) => /^pending/i.test(b.textContent ?? ''));
      if (!pendingTab) throw new Error('pending tab not found');
      await user.click(pendingTab);

      expect(screen.getByText('Grammar error here')).toBeInTheDocument();
      expect(screen.queryByText('Style suggestion here')).not.toBeInTheDocument();
    });

    it('shows "No items match this filter." when filter yields no results', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending')],
      });
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText(/^rejected/i));
      expect(screen.getByText('No items match this filter.')).toBeInTheDocument();
    });
  });

  describe('review item actions', () => {
    it('dispatches setReviewItemStatus(accepted) when Accept is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending')],
        activeStageResult: {
          ...mockContextBase.activeStageResult,
          reviewItems: [makeItem('item-1', 'pending')],
        },
      });
      render(<PipelineReviewPanel />);

      const acceptBtns = screen.getAllByText('Accept');
      await user.click(acceptBtns[0]!);

      expect(mockDispatch).toHaveBeenCalled();
      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'item-1',
        status: 'accepted',
      });
    });

    it('dispatches setReviewItemStatus(rejected) when Reject is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending')],
        activeStageResult: {
          ...mockContextBase.activeStageResult,
          reviewItems: [makeItem('item-1', 'pending')],
        },
      });
      render(<PipelineReviewPanel />);

      const rejectBtns = screen.getAllByText('Reject');
      await user.click(rejectBtns[0]!);

      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'item-1',
        status: 'rejected',
      });
    });

    it('shows original/proposed diff when "Show details" is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('item-1', 'pending', {
            original: 'old text',
            proposed: 'new text',
            rationale: 'Improves clarity',
          }),
        ],
      });
      render(<PipelineReviewPanel />);

      expect(screen.queryByText('old text')).not.toBeInTheDocument();
      await user.click(screen.getByText('Show details'));
      expect(screen.getByText('old text')).toBeInTheDocument();
      expect(screen.getByText('new text')).toBeInTheDocument();
    });

    it('toggles back to "Show details" after "Show less" is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('item-1', 'pending', { rationale: 'reason', original: 'a', proposed: 'b' }),
        ],
      });
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Show details'));
      expect(screen.getByText('Show less')).toBeInTheDocument();
      await user.click(screen.getByText('Show less'));
      expect(screen.getByText('Show details')).toBeInTheDocument();
    });

    it('shows confidence percentage', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending', { confidence: 0.85 })],
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText('85% confidence')).toBeInTheDocument();
    });
  });

  describe('batch actions', () => {
    it('dispatches acceptAllReviewItems when "Accept All" is clicked', async () => {
      const user = userEvent.setup();
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Accept All'));
      expect(vi.mocked(proForgeActions.acceptAllReviewItems)).toHaveBeenCalledWith({
        stage: 'intake',
      });
      expect(mockDispatch).toHaveBeenCalled();
    });

    it('dispatches rejectAllReviewItems when "Reject All" is clicked', async () => {
      const user = userEvent.setup();
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Reject All'));
      expect(vi.mocked(proForgeActions.rejectAllReviewItems)).toHaveBeenCalledWith({
        stage: 'intake',
      });
    });
  });

  describe('footer actions', () => {
    it('disables Submit button when there are pending items', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending')],
      });
      render(<PipelineReviewPanel />);

      const btn = screen.getByText('1 Pending');
      // biome-ignore lint/suspicious/noExplicitAny: test cast
      expect((btn as any).disabled).toBe(true);
    });

    it('enables Submit button and shows "Submit & Continue" when no items are pending', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'accepted')],
        activeStageResult: {
          ...mockContextBase.activeStageResult,
          reviewItems: [makeItem('item-1', 'accepted')],
        },
      });
      render(<PipelineReviewPanel />);

      const btn = screen.getByText('Submit & Continue');
      // biome-ignore lint/suspicious/noExplicitAny: test cast
      expect((btn as any).disabled).toBe(false);
    });

    it('calls submitReview and setActiveView("dashboard") on Submit click', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'accepted')],
        activeStageResult: {
          ...mockContextBase.activeStageResult,
          reviewItems: [makeItem('item-1', 'accepted')],
        },
      });
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Submit & Continue'));
      expect(mockSubmitReview).toHaveBeenCalledWith('intake', [
        { itemId: 'item-1', status: 'accepted' },
      ]);
      expect(mockSetActiveView).toHaveBeenCalledWith('dashboard');
    });

    it('calls skipStage and setActiveView("dashboard") when Skip Stage is clicked', async () => {
      const user = userEvent.setup();
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Skip Stage'));
      expect(mockSkipStage).toHaveBeenCalledWith('intake');
      expect(mockSetActiveView).toHaveBeenCalledWith('dashboard');
    });
  });

  describe('item severity icons', () => {
    it('renders correct severity icon for critical items', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending', { severity: 'critical' })],
      });
      render(<PipelineReviewPanel />);
      // QNBS-v3: critical items render the design-system error icon (decorative; testid is stable).
      expect(screen.getByTestId('severity-icon-critical')).toBeInTheDocument();
    });

    it('shows sectionTitle when present', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('item-1', 'pending', { sectionTitle: 'Chapter 1' })],
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    });
  });

  describe('P-5: Critical Actions summary card', () => {
    it('shows summary card when there are pending critical items', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('c-1', 'pending', { severity: 'critical', description: 'Plot break here' }),
        ],
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText(/1 Critical Issue Need/i)).toBeInTheDocument();
      // Description appears in both summary card preview and the review item card
      expect(screen.getAllByText(/Plot break here/i).length).toBeGreaterThanOrEqual(1);
    });

    it('does not show summary card when no critical pending items exist', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('w-1', 'pending', { severity: 'warning' })],
      });
      render(<PipelineReviewPanel />);
      expect(screen.queryByText(/Critical Issue/i)).not.toBeInTheDocument();
    });

    it('dispatches setReviewItemStatus for each critical item on "Accept All Critical"', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('c-1', 'pending', { severity: 'critical' }),
          makeItem('c-2', 'pending', { severity: 'critical' }),
        ],
      });
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText('Accept All Critical'));
      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'c-1',
        status: 'accepted',
      });
      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'c-2',
        status: 'accepted',
      });
    });
  });

  describe('P-5: Quick Accept High-Confidence', () => {
    it('shows Quick Accept button when eligible items exist', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('w-1', 'pending', { severity: 'warning', confidence: 0.9 }),
        ],
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText(/Quick Accept \(1\)/i)).toBeInTheDocument();
    });

    it('does not show Quick Accept button for critical pending items', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('c-1', 'pending', { severity: 'critical', confidence: 0.95 }),
        ],
      });
      render(<PipelineReviewPanel />);
      expect(screen.queryByText(/Quick Accept/i)).not.toBeInTheDocument();
    });

    it('does not show Quick Accept button when confidence is below 0.85', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('w-1', 'pending', { severity: 'warning', confidence: 0.7 }),
        ],
      });
      render(<PipelineReviewPanel />);
      expect(screen.queryByText(/Quick Accept/i)).not.toBeInTheDocument();
    });

    it('dispatches setReviewItemStatus for each eligible item on Quick Accept click', async () => {
      const user = userEvent.setup();
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('w-1', 'pending', { severity: 'warning', confidence: 0.9 }),
          makeItem('i-1', 'pending', { severity: 'info', confidence: 0.88 }),
          makeItem('c-1', 'pending', { severity: 'critical', confidence: 0.95 }), // excluded
        ],
      });
      render(<PipelineReviewPanel />);

      await user.click(screen.getByText(/Quick Accept \(2\)/i));
      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'w-1',
        status: 'accepted',
      });
      expect(vi.mocked(proForgeActions.setReviewItemStatus)).toHaveBeenCalledWith({
        stage: 'intake',
        itemId: 'i-1',
        status: 'accepted',
      });
      // Critical item must NOT be auto-accepted
      const calls = vi.mocked(proForgeActions.setReviewItemStatus).mock.calls;
      expect(calls.every(([p]) => (p as { itemId: string }).itemId !== 'c-1')).toBe(true);
    });
  });

  describe('P-5: severity-grouped view', () => {
    it('renders severity group headers in all view', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [
          makeItem('c-1', 'pending', { severity: 'critical' }),
          makeItem('w-1', 'pending', { severity: 'warning' }),
          makeItem('i-1', 'pending', { severity: 'info' }),
        ],
      });
      render(<PipelineReviewPanel />);
      expect(screen.getByText('Critical Actions')).toBeInTheDocument();
      expect(screen.getByText('Warnings')).toBeInTheDocument();
      expect(screen.getByText('Suggestions')).toBeInTheDocument();
    });

    it('omits group headers for severities with no items', () => {
      vi.mocked(useProForgeViewContext).mockReturnValue({
        ...mockContextBase,
        currentStageReviewItems: [makeItem('w-1', 'pending', { severity: 'warning' })],
      });
      render(<PipelineReviewPanel />);
      expect(screen.queryByText('Critical Actions')).not.toBeInTheDocument();
      expect(screen.getByText('Warnings')).toBeInTheDocument();
      expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    });
  });
});
