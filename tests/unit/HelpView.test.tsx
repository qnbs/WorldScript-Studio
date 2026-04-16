import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpView } from '../../components/HelpView';

beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = vi.fn();
});

const mockHandleSelectCategory = vi.fn();
const mockHandleAskAi = vi.fn();
const mockSetUserInput = vi.fn();

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
    activeCategory: 'ai',
    selectedArticle: null,
    handleSelectCategory: mockHandleSelectCategory,
    handleSelectArticle: vi.fn(),
    handleBackToList: vi.fn(),
    chatHistory: [{ role: 'model', text: 'Welcome to the help assistant.' }],
    userInput: 'Test input',
    setUserInput: mockSetUserInput,
    isAiReplying: false,
    handleAskAi: mockHandleAskAi,
  }),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: () => 'light',
}));

describe('HelpView', () => {
  beforeEach(() => {
    mockHandleSelectCategory.mockClear();
    mockHandleAskAi.mockClear();
    mockSetUserInput.mockClear();
  });

  it('renders the AI assistant section when ai category is active', () => {
    render(<HelpView />);

    expect(screen.getByRole('heading', { name: 'help.ai.title' })).toBeInTheDocument();
    expect(screen.getByText('Welcome to the help assistant.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('help.ai.placeholder')).toBeInTheDocument();
  });

  it('calls handleSelectCategory when a navigation button is clicked', () => {
    render(<HelpView />);

    const navButton = screen.getByText('help.story.title');
    fireEvent.click(navButton);

    expect(mockHandleSelectCategory).toHaveBeenCalledWith('story');
  });

  it('submits the AI query when the ask button is clicked', () => {
    render(<HelpView />);

    const askButton = screen.getByRole('button', { name: 'help.tabs.askAi' });
    fireEvent.click(askButton);

    expect(mockHandleAskAi).toHaveBeenCalled();
  });
});
