import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressTrackerView } from '../../components/ProgressTrackerView';

const mockDispatch = vi.fn();
const mockSessionActive = { startedAt: Date.now(), startWordCount: 100 };
const today = new Date().toISOString().slice(0, 10);

const makeMockState = (progressTrackerOverride = {}) => ({
  project: {
    present: {
      data: {
        manuscript: [{ id: 'ms1', content: 'hello world test' }],
        writingHistory: [
          { date: today, words: 300 },
          { date: '2024-01-01', words: 500 },
        ],
      },
    },
  },
  progressTracker: {
    dailyGoalWords: 500,
    weeklyGoalWords: 2500,
    activeSession: null,
    streakDays: 3,
    longestStreak: 7,
    totalWordsAllTime: 1200,
    ...progressTrackerOverride,
  },
  settings: { language: 'en', theme: 'dark' },
});

let mockState = makeMockState();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../components/ui/SectionIcon', () => ({
  SectionIcon: () => null,
}));

describe('ProgressTrackerView', () => {
  beforeEach(() => {
    mockState = makeMockState();
    mockDispatch.mockClear();
    vi.useFakeTimers();
  });

  it('renders the daily goal progress section', () => {
    render(<ProgressTrackerView />);
    expect(screen.getByText('progress.today.title')).toBeDefined();
  });

  it('shows streak i18n key with count', () => {
    render(<ProgressTrackerView />);
    expect(screen.getByText('progress.streak.title')).toBeDefined();
    // streak.days key appears with the mock t() returning the key
    expect(screen.getByText('progress.streak.days')).toBeDefined();
  });

  it('shows Start Session button when no session active', () => {
    render(<ProgressTrackerView />);
    expect(screen.getByRole('button', { name: 'progress.session.start' })).toBeDefined();
  });

  it('dispatches startSession when Start Session clicked', () => {
    render(<ProgressTrackerView />);
    fireEvent.click(screen.getByRole('button', { name: 'progress.session.start' }));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('shows Stop Session button when session is active', async () => {
    mockState = makeMockState({ activeSession: mockSessionActive });
    const { useAppSelector } = await import('../../app/hooks');
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(mockState as any),
    );
    render(<ProgressTrackerView />);
    expect(screen.getByRole('button', { name: 'progress.session.stop' })).toBeDefined();
  });

  it('dispatches endSession when Stop Session clicked', async () => {
    mockState = makeMockState({ activeSession: mockSessionActive });
    const { useAppSelector } = await import('../../app/hooks');
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(mockState as any),
    );
    render(<ProgressTrackerView />);
    fireEvent.click(screen.getByRole('button', { name: 'progress.session.stop' }));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('renders velocity chart SVG with role img', () => {
    render(<ProgressTrackerView />);
    const charts = screen.getAllByRole('img');
    expect(charts.length).toBeGreaterThan(0);
  });

  it('shows no-data message when writing history is empty', async () => {
    mockState = {
      ...makeMockState(),
      project: { present: { data: { manuscript: [], writingHistory: [] } } },
    };
    const { useAppSelector } = await import('../../app/hooks');
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(mockState as any),
    );
    render(<ProgressTrackerView />);
    expect(screen.getByText('progress.chart.noData')).toBeDefined();
  });

  it('shows weekly goal section', () => {
    render(<ProgressTrackerView />);
    expect(screen.getByText('progress.weekly.title')).toBeDefined();
  });

  it('renders goal settings inputs', () => {
    render(<ProgressTrackerView />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('dispatches setDailyGoal on daily goal input change', () => {
    render(<ProgressTrackerView />);
    const dailyInput = screen.getByLabelText('progress.goals.daily');
    fireEvent.change(dailyInput, { target: { value: '750' } });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('renders heatmap SVG', () => {
    render(<ProgressTrackerView />);
    const heatmap = screen.getByRole('img', { name: 'progress.heatmap.ariaLabel' });
    expect(heatmap).toBeDefined();
  });

  it('session timer displays timer element when session active', async () => {
    mockState = makeMockState({ activeSession: mockSessionActive });
    const { useAppSelector } = await import('../../app/hooks');
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(mockState as any),
    );
    render(<ProgressTrackerView />);
    expect(screen.getByRole('timer')).toBeDefined();
  });
});
