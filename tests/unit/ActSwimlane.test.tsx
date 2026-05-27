/**
 * Tests for components/scene-board/ActSwimlane.tsx
 * QNBS-v3: Mocks @dnd-kit/sortable and SceneCard; tests render, word count, add button, empty state.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock('../../components/scene-board/SceneCard', () => ({
  SceneCard: ({ section }: { section: { title: string } }) => (
    <li data-testid="scene-card">{section.title}</li>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ActSwimlane } from '../../components/scene-board/ActSwimlane';
import type { StorySection } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const t = (k: string) => k;
const SECTION: StorySection = {
  id: 'sec-1',
  title: 'Scene One',
  content: '',
  act: 1,
  wordCount: 500,
};

const BASE_PROPS = {
  act: 1 as const,
  sections: [],
  characters: [],
  locationOptions: [],
  t,
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onAddSection: vi.fn(),
  onReorderInAct: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActSwimlane', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders act label', () => {
    render(<ActSwimlane {...BASE_PROPS} />);
    expect(screen.getByText('sceneboard.act1.label')).toBeInTheDocument();
  });

  it('shows scene count and word count', () => {
    render(<ActSwimlane {...BASE_PROPS} sections={[SECTION]} />);
    // The paragraph shows "1 sceneboard.scenes · 500 sceneboard.words"
    const para = screen.getByText(/sceneboard\.scenes/);
    expect(para.textContent).toContain('1');
    expect(para.textContent).toContain('500');
  });

  it('renders empty state when no sections', () => {
    render(<ActSwimlane {...BASE_PROPS} sections={[]} />);
    expect(screen.getByText('sceneboard.dragEmptyHint')).toBeInTheDocument();
  });

  it('renders SceneCard for each section', () => {
    render(
      <ActSwimlane
        {...BASE_PROPS}
        sections={[SECTION, { ...SECTION, id: 'sec-2', title: 'Scene Two' }]}
      />,
    );
    expect(screen.getAllByTestId('scene-card')).toHaveLength(2);
  });

  it('calls onAddSection with correct act when + button clicked', async () => {
    const onAddSection = vi.fn();
    const user = userEvent.setup();
    render(<ActSwimlane {...BASE_PROPS} onAddSection={onAddSection} />);
    await user.click(screen.getByRole('button'));
    expect(onAddSection).toHaveBeenCalledWith(1);
  });

  it('applies different gradient for act 2', () => {
    const { container } = render(<ActSwimlane {...BASE_PROPS} act={2} />);
    expect((container.firstChild as HTMLElement).className).toContain('from-purple-500');
  });

  it('applies focus border class when isOver=true', () => {
    const { container } = render(<ActSwimlane {...BASE_PROPS} isOver />);
    expect((container.firstChild as HTMLElement).className).toContain(
      'border-[var(--sc-border-focus)]',
    );
  });
});
