import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../components/Dashboard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOnNavigate = vi.fn();

const baseProjectData = {
  title: 'Epic Adventure',
  logline: 'A brave hero sets forth.',
  genre: 'Fantasy',
  manuscript: [
    { id: 'm1', title: 'Chapter 1', content: 'Once upon a time...' },
    { id: 'm2', title: 'Chapter 2', content: 'The hero departs.' },
  ],
  outline: [],
  characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Hero' } } },
  worlds: { ids: [], entities: {} },
  writingGoals: null,
};

const baseContextValue = {
  t: (k: string) => k,
  project: baseProjectData,
  characters: [{ id: 'c1', name: 'Hero' }],
  worlds: [],
  wordCount: 900,
  wordCountProgress: 30,
  readability: { score: 65, label: 'Standard', color: '#10b981' },
  sceneTimelineHints: [],
  daysLeft: 10,
  onNavigate: mockOnNavigate,
  // Header / greeting
  greetingKey: 'dashboard.header.greetingMorning',
  continueSection: { id: 'm2', title: 'Chapter 2' },
  // Momentum
  streakDays: 3,
  longestStreak: 5,
  dailyGoalWords: 500,
  weeklyGoalWords: 2500,
  wordsToday: 250,
  wordsThisWeek: 1200,
  dailyGoalProgress: 50,
  weeklyGoalProgress: 48,
  recentActivity: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    words: i % 3 === 0 ? 300 : 0,
    isToday: i === 13,
  })),
  // Composition
  sceneCount: 2,
  readingTimeMinutes: 4,
  avgWordsPerScene: 450,
  statusCounts: { draft: 1, final: 1 },
  // Pace + health
  wordsRemaining: 49100,
  requiredPerDay: 4910,
  paceStatus: 'behind' as const,
  healthBreakdown: { writing: 30, cast: 10, world: 0, score: 19 },
  isGoalModalOpen: false,
  setIsGoalModalOpen: vi.fn(),
  goalWordCount: 50000,
  setGoalWordCount: vi.fn(),
  goalTargetDate: '',
  setGoalTargetDate: vi.fn(),
  openGoalModal: vi.fn(),
  handleSaveGoals: vi.fn(),
  isLoglineModalOpen: false,
  setIsLoglineModalOpen: vi.fn(),
  loglineSuggestions: [],
  isAiLoading: false,
  handleGenerateLoglines: vi.fn(),
  selectLogline: vi.fn(),
  handleTitleChange: vi.fn(),
  handleLoglineChange: vi.fn(),
};

vi.mock('../../hooks/useDashboard', () => ({
  useDashboard: vi.fn(() => baseContextValue),
}));

vi.mock('../../contexts/FeatureFlagsContext', () => ({
  useFeatureFlags: vi.fn(() => ({
    enableProjectHealthScore: true,
    enableCompileWizard: false,
    enableManuscriptResearchSplit: false,
  })),
  FeatureFlagsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../services/spotlightTour', () => ({
  startSpotlightTour: vi.fn(),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// QNBS-v3: BackupQuickActionsCard calls storageService.listSnapshots() on mount.
// Without a mock, jsdom's undefined indexedDB stub throws an unhandled rejection.
vi.mock('../../services/storageService', () => ({
  storageService: {
    listSnapshots: vi.fn().mockResolvedValue([]),
    saveProject: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn().mockResolvedValue(null),
    exportProject: vi.fn().mockResolvedValue(undefined),
    importProject: vi.fn().mockResolvedValue(null),
  },
}));

import type React from 'react';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  it('renders without throwing', () => {
    expect(() => render(<Dashboard onNavigate={mockOnNavigate} />)).not.toThrow();
  });

  it('shows project title in input field', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByDisplayValue('Epic Adventure')).toBeTruthy();
  });

  it('shows dashboard project details title', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.details.projectTitle')).toBeTruthy();
  });

  it('shows quick access section', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.quickAccess.manuscriptDesc')).toBeTruthy();
  });

  it('shows word count stats', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    // Word count appears in stat cards
    const items = screen.getAllByText(/900/);
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows author insights section', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.authorInsights.title')).toBeTruthy();
  });

  it('shows logline field', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getAllByText('dashboard.details.logline').length).toBeGreaterThan(0);
  });

  it('renders the personalized greeting header', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.header.greetingMorning')).toBeTruthy();
    // Project title appears prominently in the hero
    expect(screen.getAllByText('Epic Adventure').length).toBeGreaterThan(0);
  });

  it('renders the writing momentum card with streak', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.momentum.title')).toBeTruthy();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0); // streakDays (chip + card)
  });

  it('renders the manuscript composition card', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.composition.title')).toBeTruthy();
  });

  it('renders the pace projection in the goal tracker', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    expect(screen.getByText('dashboard.goals.pace.title')).toBeTruthy();
    // paceStatus 'behind' renders its badge
    expect(screen.getByText('dashboard.goals.pace.behind')).toBeTruthy();
  });

  it('navigates to the manuscript when Continue Writing is clicked', () => {
    render(<Dashboard onNavigate={mockOnNavigate} />);
    screen.getByText('dashboard.continueWriting.button').click();
    expect(mockOnNavigate).toHaveBeenCalledWith('manuscript');
  });
});
