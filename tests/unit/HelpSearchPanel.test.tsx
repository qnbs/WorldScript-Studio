/**
 * Tests for components/help/HelpSearchPanel.tsx and HelpSearchInput.
 * QNBS-v3: Mocks useSpeechRecognition (used by Input); tests search result display.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (useSpeechRecognition used by Input atom)
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { HelpSearchInput, HelpSearchPanel } from '../../components/help/HelpSearchPanel';
import type { FlatHelpArticle } from '../../services/help/helpSearch';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const translate = (k: string, opts?: Record<string, string>) =>
  opts ? `${k}:${JSON.stringify(opts)}` : k;

const ARTICLE: FlatHelpArticle = {
  categoryId: 'general',
  categoryTitleKey: 'help.categories.general',
  titleKey: 'help.articles.gettingStarted',
  bodyKey: 'help.articles.gettingStartedBody',
  tags: ['basics'],
};

// ---------------------------------------------------------------------------
// HelpSearchPanel tests
// ---------------------------------------------------------------------------

describe('HelpSearchPanel', () => {
  it('renders nothing when query is empty', () => {
    const { container } = render(
      <HelpSearchPanel
        query=""
        onQueryChange={vi.fn()}
        results={[]}
        translate={translate}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders panel when query is non-empty', () => {
    render(
      <HelpSearchPanel
        query="help"
        onQueryChange={vi.fn()}
        results={[]}
        translate={translate}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('help.searchResultsTitle')).toBeInTheDocument();
  });

  it('shows no results message when results are empty', () => {
    render(
      <HelpSearchPanel
        query="xyz"
        onQueryChange={vi.fn()}
        results={[]}
        translate={translate}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/noResults/)).toBeInTheDocument();
  });

  it('renders result items', () => {
    render(
      <HelpSearchPanel
        query="getting"
        onQueryChange={vi.fn()}
        results={[ARTICLE]}
        translate={translate}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(ARTICLE.titleKey)).toBeInTheDocument();
    expect(screen.getByText(ARTICLE.categoryTitleKey)).toBeInTheDocument();
  });

  it('calls onSelect when a result button is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <HelpSearchPanel
        query="getting"
        onQueryChange={vi.fn()}
        results={[ARTICLE]}
        translate={translate}
        onSelect={onSelect}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByText(ARTICLE.titleKey).closest('button') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(ARTICLE);
  });

  it('calls onClear when cancel button is clicked', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <HelpSearchPanel
        query="test"
        onQueryChange={vi.fn()}
        results={[]}
        translate={translate}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// HelpSearchInput tests
// ---------------------------------------------------------------------------

describe('HelpSearchInput', () => {
  it('renders a search input', () => {
    render(<HelpSearchInput value="" onChange={vi.fn()} placeholder="Search help..." />);
    expect(screen.getByPlaceholderText('Search help...')).toBeInTheDocument();
  });

  it('calls onChange when user types', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HelpSearchInput value="" onChange={onChange} placeholder="Search..." />);
    await user.type(screen.getByPlaceholderText('Search...'), 'a');
    expect(onChange).toHaveBeenCalled();
  });
});
