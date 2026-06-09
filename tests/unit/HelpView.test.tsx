import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpView } from '../../components/HelpView';

beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = vi.fn();
});

const mockHandleSelectCategory = vi.fn();

const mockHelpContent = [
  {
    id: 'story',
    title: 'help.story.title',
    icon: 'DOCUMENT_TEXT',
    articles: [{ title: 'help.story.article1', content: '<p>Story content</p>' }],
  },
];

vi.mock('../../hooks/useHelpView', () => ({
  useHelpView: () => ({
    t: (key: string) => key,
    helpContent: mockHelpContent,
    activeCategory: 'story',
    selectedArticle: null,
    handleSelectCategory: mockHandleSelectCategory,
    handleSelectArticle: vi.fn(),
    handleSearchSelect: vi.fn(),
    handleBackToList: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchResults: [],
  }),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: () => 'light',
}));

describe('HelpView', () => {
  beforeEach(() => {
    mockHandleSelectCategory.mockClear();
  });

  it('renders the help title heading', () => {
    render(<HelpView />);
    expect(screen.getByRole('heading', { name: 'help.title' })).toBeInTheDocument();
  });

  it('renders article list when a matching category is active', () => {
    render(<HelpView />);
    // ArticleList renders the category title as an h2 heading
    expect(screen.getByRole('heading', { level: 2, name: 'help.story.title' })).toBeInTheDocument();
    // Article items are rendered as buttons
    expect(screen.getByRole('button', { name: 'help.story.article1' })).toBeInTheDocument();
  });

  it('calls handleSelectCategory when a navigation button is clicked', () => {
    render(<HelpView />);

    // The nav renders each category as a <button> — use getByRole to disambiguate from the ArticleList heading
    const navButtons = screen.getAllByRole('button', { name: 'help.story.title' });
    fireEvent.click(navButtons[0]!);

    expect(mockHandleSelectCategory).toHaveBeenCalledWith('story');
  });
});
