/**
 * Tests for components/manuscript/ReferencePanelView.tsx
 * QNBS-v3: Mocks selectors + sub-components; tests tab switching, empty states, character/world display.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDispatch, mockCharacters, mockWorlds, mockProjectData, mockComments } = vi.hoisted(
  () => ({
    mockDispatch: vi.fn(),
    mockCharacters: [] as unknown[],
    mockWorlds: [] as unknown[],
    mockProjectData: {
      id: 'proj1',
      binderNodes: [],
      manuscript: [],
    } as Record<string, unknown>,
    mockComments: [] as unknown[],
  }),
);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const MOCK_STATE = {
  project: {
    present: {
      data: {
        id: 'proj1',
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
        manuscript: [],
        binderNodes: [],
      },
    },
  },
  featureFlags: { enableDuckDbAnalytics: false },
  sceneComments: { comments: { ids: [], entities: {} } },
};

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) => selector(MOCK_STATE)),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => mockCharacters,
  selectAllWorlds: () => mockWorlds,
  selectProjectData: () => mockProjectData,
}));

vi.mock('../../features/sceneComments/sceneCommentsSlice', () => ({
  selectCommentsBySection: () => () => mockComments,
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/localRagService', () => ({
  rebuildHybridRagIndex: vi.fn().mockResolvedValue(42),
}));

// Stub heavy sub-components to avoid their own Redux / service deps
vi.mock('../../components/manuscript/CommentsPanel', () => ({
  CommentsPanel: () => <div data-testid="comments-panel">CommentsPanel</div>,
}));

vi.mock('../../components/manuscript/SceneRevisionPanel', () => ({
  SceneRevisionPanel: () => <div data-testid="revisions-panel">SceneRevisionPanel</div>,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ReferencePanelView } from '../../components/manuscript/ReferencePanelView';
import type { StorySection } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION: StorySection = {
  id: 'sec-1',
  title: 'Chapter 1',
  content: '',
  act: 1,
  wordCount: 100,
  type: 'scene',
  order: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReferencePanelView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to empty data
    mockCharacters.length = 0;
    mockWorlds.length = 0;
    mockComments.length = 0;
    mockProjectData.binderNodes = [];
  });

  it('renders the tab bar with all tabs', () => {
    render(<ReferencePanelView section={SECTION} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.characters' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.world' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.notes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.binder' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.comments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'reference.tabs.revisions' })).toBeInTheDocument();
  });

  it('shows characters empty state on default tab', () => {
    render(<ReferencePanelView section={SECTION} />);
    expect(screen.getByText('reference.characters.empty')).toBeInTheDocument();
  });

  it('shows character name when character is linked', () => {
    mockCharacters.push({ id: 'char-1', name: 'Alice', hasAvatar: false, backstory: '' });
    const section = { ...SECTION, characterIds: ['char-1'] };
    render(<ReferencePanelView section={section} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows character avatar initial when hasAvatar is true', () => {
    mockCharacters.push({ id: 'char-1', name: 'Bob', hasAvatar: true, backstory: 'A hero' });
    const section = { ...SECTION, characterIds: ['char-1'] };
    render(<ReferencePanelView section={section} />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('switches to world tab and shows empty state', async () => {
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.world' }));
    expect(screen.getByText('reference.world.empty')).toBeInTheDocument();
  });

  it('shows world name when world is linked', async () => {
    const user = userEvent.setup();
    mockWorlds.push({ id: 'world-1', name: 'Middle Earth', description: 'A vast world' });
    const section = { ...SECTION, worldIds: ['world-1'] };
    render(<ReferencePanelView section={section} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.world' }));
    expect(screen.getByText('Middle Earth')).toBeInTheDocument();
  });

  it('switches to notes tab and shows textarea', async () => {
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.notes' }));
    expect(screen.getByRole('textbox', { name: 'reference.notes.ariaLabel' })).toBeInTheDocument();
  });

  it('notes textarea shows section notes value', async () => {
    const user = userEvent.setup();
    const section = { ...SECTION, notes: 'My notes here' };
    render(<ReferencePanelView section={section} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.notes' }));
    expect(screen.getByRole('textbox', { name: 'reference.notes.ariaLabel' })).toHaveValue(
      'My notes here',
    );
  });

  it('switches to binder tab and shows empty state', async () => {
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.binder' }));
    expect(screen.getByText('reference.binder.empty')).toBeInTheDocument();
  });

  it('switches to comments tab and renders CommentsPanel stub', async () => {
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.comments' }));
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
  });

  it('switches to revisions tab and renders SceneRevisionPanel stub', async () => {
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByRole('tab', { name: 'reference.tabs.revisions' }));
    expect(screen.getByTestId('revisions-panel')).toBeInTheDocument();
  });

  it('shows reindex button in footer', () => {
    render(<ReferencePanelView section={SECTION} />);
    expect(screen.getByText('reference.reindex.action')).toBeInTheDocument();
  });

  it('shows comment count in tab label when there are unresolved comments', () => {
    mockComments.push({ id: 'c1', sectionId: 'sec-1', resolved: false });
    render(<ReferencePanelView section={SECTION} />);
    expect(screen.getByText(/reference.tabs.comments.*1/)).toBeInTheDocument();
  });

  it('calls rebuildHybridRagIndex when reindex button is clicked', async () => {
    const { rebuildHybridRagIndex } = await import('../../services/localRagService');
    const user = userEvent.setup();
    render(<ReferencePanelView section={SECTION} />);
    await user.click(screen.getByText('reference.reindex.action'));
    await waitFor(() => expect(rebuildHybridRagIndex).toHaveBeenCalled());
  });
});
