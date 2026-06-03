import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectActions } from '../../../features/project/projectSlice';
import { useDashboard } from '../../../hooks/useDashboard';
import type { StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks (hoisted before imports above are evaluated)
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockUnwrap = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const mockComputeReadability = vi.fn((_text: string) => ({
  score: 65,
  grade: 'easy' as const,
  avgSentenceLength: 15,
  avgSyllablesPerWord: 1.5,
}));
const mockEvaluateTimeline = vi.fn(
  (_sections: StorySection[]) =>
    [] as { id: string; severity: 'info' | 'warn'; messageKey: string }[],
);
const mockSamplePlainText = vi.fn((sections: StorySection[]) =>
  sections.map((s) => s.content ?? '').join(' '),
);

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: vi.fn(),
  selectAllCharacters: vi.fn(() => []),
  selectAllWorlds: vi.fn(() => []),
}));

vi.mock('../../../features/project/thunks/writingThunks', () => ({
  generateLoglineSuggestionsThunk: vi.fn(() => ({ type: 'mock-logline-thunk' })),
}));

vi.mock('../../../services/readabilityFlesch', () => ({
  computeReadabilitySnapshot: (...args: [string]) => mockComputeReadability(...args),
}));

vi.mock('../../../services/sceneTimelineRules', () => ({
  evaluateSceneTimeline: (...args: [StorySection[]]) => mockEvaluateTimeline(...args),
}));

vi.mock('../../../services/manuscriptMetricsSampling', () => ({
  sampleManuscriptPlainText: (...args: [StorySection[]]) => mockSamplePlainText(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { selectProjectData } from '../../../features/project/projectSelectors';

const defaultSection = (id: string, content: string): StorySection => ({
  id,
  title: `Section ${id}`,
  content,
});

const defaultProject = () => ({
  title: 'My Novel',
  logline: '',
  manuscript: [] as StorySection[],
  characters: [],
  worlds: [],
  projectGoals: undefined as undefined | { totalWordCount: number; targetDate: string | null },
});

function setProjectData(overrides: Partial<ReturnType<typeof defaultProject>> = {}) {
  vi.mocked(selectProjectData).mockReturnValue({
    ...defaultProject(),
    ...overrides,
  } as unknown as ReturnType<typeof selectProjectData>);
}

const onNavigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockReturnValue({ unwrap: mockUnwrap });
  mockUnwrap.mockResolvedValue([]);
  setProjectData();
});

// ---------------------------------------------------------------------------
// wordCount
// ---------------------------------------------------------------------------
describe('wordCount', () => {
  it('returns 0 for an empty manuscript', () => {
    setProjectData({ manuscript: [] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCount).toBe(0);
  });

  it('counts words in a single section', () => {
    setProjectData({ manuscript: [defaultSection('s1', 'Hello world foo')] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCount).toBe(3);
  });

  it('sums words across multiple sections', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'one two three'), defaultSection('s2', 'four five')],
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCount).toBe(5);
  });

  it('treats empty section content as 0 words', () => {
    setProjectData({ manuscript: [defaultSection('s1', '')] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// wordCountProgress
// ---------------------------------------------------------------------------
describe('wordCountProgress', () => {
  it('returns 0 when no project goal is set', () => {
    setProjectData({ manuscript: [defaultSection('s1', 'hello world')] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCountProgress).toBe(0);
  });

  it('computes percentage relative to goal', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b c d e')], // 5 words
      projectGoals: { totalWordCount: 10, targetDate: null },
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCountProgress).toBe(50);
  });

  it('can exceed 100% when over goal', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b c')], // 3 words
      projectGoals: { totalWordCount: 1, targetDate: null },
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordCountProgress).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// readability
// ---------------------------------------------------------------------------
describe('readability', () => {
  it('calls computeReadabilitySnapshot via sampleManuscriptPlainText', () => {
    setProjectData({ manuscript: [defaultSection('s1', 'Some text')] });
    renderHook(() => useDashboard({ onNavigate }));
    expect(mockSamplePlainText).toHaveBeenCalled();
    expect(mockComputeReadability).toHaveBeenCalled();
  });

  it('returns the snapshot from computeReadabilitySnapshot', () => {
    const snap = {
      score: 70,
      grade: 'easy' as const,
      avgSentenceLength: 12,
      avgSyllablesPerWord: 1.2,
    };
    mockComputeReadability.mockReturnValue(snap);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.readability).toEqual(snap);
  });
});

// ---------------------------------------------------------------------------
// sceneTimelineHints
// ---------------------------------------------------------------------------
describe('sceneTimelineHints', () => {
  it('returns empty array when evaluateSceneTimeline returns nothing', () => {
    mockEvaluateTimeline.mockReturnValue([]);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.sceneTimelineHints).toEqual([]);
  });

  it('forwards hints from evaluateSceneTimeline', () => {
    const hint = {
      id: 'hint-1',
      severity: 'warn' as const,
      messageKey: 'sceneboard.timeline.noOpening',
    };
    mockEvaluateTimeline.mockReturnValue([hint]);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.sceneTimelineHints).toEqual([hint]);
  });
});

// ---------------------------------------------------------------------------
// daysLeft
// ---------------------------------------------------------------------------
describe('daysLeft', () => {
  it('returns null when no targetDate is set', () => {
    setProjectData({ projectGoals: { totalWordCount: 50000, targetDate: null } });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.daysLeft).toBeNull();
  });

  it('returns null when projectGoals is undefined', () => {
    setProjectData({ projectGoals: undefined });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.daysLeft).toBeNull();
  });

  it('returns a positive number for a future target date', () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const dateStr = future.toISOString().split('T')[0] ?? '';
    setProjectData({ projectGoals: { totalWordCount: 50000, targetDate: dateStr } });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.daysLeft).toBeGreaterThan(0);
  });

  it('returns a negative number for a past target date', () => {
    setProjectData({ projectGoals: { totalWordCount: 50000, targetDate: '2020-01-01' } });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.daysLeft).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// openGoalModal
// ---------------------------------------------------------------------------
describe('openGoalModal', () => {
  it('opens the goal modal', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.isGoalModalOpen).toBe(false);

    act(() => result.current.openGoalModal());

    expect(result.current.isGoalModalOpen).toBe(true);
  });

  it('initialises goalWordCount from project goals', () => {
    setProjectData({ projectGoals: { totalWordCount: 80000, targetDate: null } });
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.openGoalModal());

    expect(result.current.goalWordCount).toBe(80000);
  });

  it('defaults goalWordCount to 50000 when no goal is set', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.openGoalModal());

    expect(result.current.goalWordCount).toBe(50000);
  });

  it('initialises goalTargetDate from project goals', () => {
    setProjectData({ projectGoals: { totalWordCount: 50000, targetDate: '2027-06-01' } });
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.openGoalModal());

    expect(result.current.goalTargetDate).toBe('2027-06-01');
  });
});

// ---------------------------------------------------------------------------
// handleSaveGoals
// ---------------------------------------------------------------------------
describe('handleSaveGoals', () => {
  it('dispatches updateProjectGoal for totalWordCount', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.setGoalWordCount(75000));
    act(() => result.current.handleSaveGoals());

    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateProjectGoal({ key: 'totalWordCount', value: 75000 }),
    );
  });

  it('dispatches updateProjectGoal for targetDate', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.setGoalTargetDate('2028-01-01'));
    act(() => result.current.handleSaveGoals());

    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateProjectGoal({ key: 'targetDate', value: '2028-01-01' }),
    );
  });

  it('sends null when targetDate is empty string', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.setGoalTargetDate(''));
    act(() => result.current.handleSaveGoals());

    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateProjectGoal({ key: 'targetDate', value: null }),
    );
  });

  it('closes the goal modal after saving', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.openGoalModal());
    expect(result.current.isGoalModalOpen).toBe(true);

    act(() => result.current.handleSaveGoals());
    expect(result.current.isGoalModalOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleGenerateLoglines
// ---------------------------------------------------------------------------
describe('handleGenerateLoglines', () => {
  it('opens the logline modal', async () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    expect(result.current.isLoglineModalOpen).toBe(true);
  });

  it('clears prior suggestions when called', async () => {
    mockUnwrap.mockResolvedValue(['First call logline']);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(result.current.loglineSuggestions).toEqual(['First call logline']);

    // QNBS-v3: second call should clear old suggestions before the new request resolves
    mockUnwrap.mockResolvedValue(['Second call logline']);
    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(result.current.loglineSuggestions).toEqual(['Second call logline']);
  });

  it('sets loglineSuggestions on fulfilled dispatch', async () => {
    mockUnwrap.mockResolvedValue(['A brave hero', 'A dark secret']);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    await waitFor(() =>
      expect(result.current.loglineSuggestions).toEqual(['A brave hero', 'A dark secret']),
    );
  });

  it('resets isAiLoading to false after fulfilled', async () => {
    mockUnwrap.mockResolvedValue([]);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    expect(result.current.isAiLoading).toBe(false);
  });

  it('calls toast.error and closes modal on rejection', async () => {
    mockUnwrap.mockRejectedValue('AI unavailable');
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    expect(mockToast.error).toHaveBeenCalled();
    expect(result.current.isLoglineModalOpen).toBe(false);
  });

  it('resets isAiLoading to false after rejection', async () => {
    mockUnwrap.mockRejectedValue(new Error('Network error'));
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    expect(result.current.isAiLoading).toBe(false);
  });

  it('dispatches generateLoglineSuggestionsThunk', async () => {
    mockUnwrap.mockResolvedValue([]);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });

    expect(mockDispatch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectLogline
// ---------------------------------------------------------------------------
describe('selectLogline', () => {
  it('dispatches updateLogline with the selected logline', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.selectLogline('A warrior finds destiny'));

    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateLogline('A warrior finds destiny'),
    );
  });

  it('closes the logline modal after selection', async () => {
    mockUnwrap.mockResolvedValue(['Some logline']);
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(result.current.isLoglineModalOpen).toBe(true);

    act(() => result.current.selectLogline('Some logline'));
    expect(result.current.isLoglineModalOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleTitleChange / handleLoglineChange
// ---------------------------------------------------------------------------
describe('handleTitleChange', () => {
  it('dispatches updateTitle with the new value', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.handleTitleChange('New Novel Title'));

    expect(mockDispatch).toHaveBeenCalledWith(projectActions.updateTitle('New Novel Title'));
  });
});

describe('handleLoglineChange', () => {
  it('dispatches updateLogline with the new value', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));

    act(() => result.current.handleLoglineChange('A new logline text'));

    expect(mockDispatch).toHaveBeenCalledWith(projectActions.updateLogline('A new logline text'));
  });
});

// ---------------------------------------------------------------------------
// Derived dashboard insights (greeting / continue / composition / pace / health)
// ---------------------------------------------------------------------------
describe('greetingKey', () => {
  it('returns a valid greeting i18n key', () => {
    setProjectData({});
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.greetingKey).toMatch(/^dashboard\.header\.greeting/);
  });
});

describe('continueSection', () => {
  it('is null for an empty manuscript', () => {
    setProjectData({ manuscript: [] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.continueSection).toBeNull();
  });

  it('points at the last section with content', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'one two three'), defaultSection('s2', 'four five')],
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.continueSection).toEqual({ id: 's2', title: 'Section s2' });
  });

  it('falls back to the first section when none have content', () => {
    setProjectData({ manuscript: [defaultSection('s1', ''), defaultSection('s2', '')] });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.continueSection).toEqual({ id: 's1', title: 'Section s1' });
  });
});

describe('manuscript composition', () => {
  it('counts scenes and computes averages and reading time', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'one two three'), defaultSection('s2', 'four five')],
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.sceneCount).toBe(2);
    expect(result.current.avgWordsPerScene).toBe(3); // 5 words / 2 scenes, rounded
    expect(result.current.readingTimeMinutes).toBe(1); // floor below WPM clamps to 1
  });

  it('buckets sections without a status into "untracked"', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b'), defaultSection('s2', 'c d')],
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.statusCounts).toEqual({ untracked: 2 });
  });

  it('buckets sections by their explicit status', () => {
    setProjectData({
      manuscript: [
        { ...defaultSection('s1', 'a b'), status: 'final' },
        { ...defaultSection('s2', 'c d'), status: 'draft' },
        { ...defaultSection('s3', 'e f'), status: 'draft' },
      ],
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.statusCounts).toEqual({ final: 1, draft: 2 });
  });
});

describe('pace + health', () => {
  it('reports words remaining toward the goal', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b c')], // 3 words
      projectGoals: { totalWordCount: 10, targetDate: null },
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordsRemaining).toBe(7);
  });

  it('marks the goal done when the manuscript meets it', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b c')], // 3 words
      projectGoals: { totalWordCount: 3, targetDate: null },
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.wordsRemaining).toBe(0);
    expect(result.current.paceStatus).toBe('done');
  });

  it('computes a health breakdown weighted toward writing progress', () => {
    setProjectData({
      manuscript: [defaultSection('s1', 'a b c d e')], // 5 words
      projectGoals: { totalWordCount: 10, targetDate: null },
    });
    const { result } = renderHook(() => useDashboard({ onNavigate }));
    expect(result.current.healthBreakdown.writing).toBe(50);
    expect(result.current.healthBreakdown.cast).toBe(0);
    expect(result.current.healthBreakdown.world).toBe(0);
    expect(result.current.healthBreakdown.score).toBe(28); // round(50 * 0.55)
  });
});
