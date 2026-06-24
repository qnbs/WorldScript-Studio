import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageToolMatch } from '../../services/languageToolService';

// Mutable mock state so individual tests vary locale / enabled / dispatch.
const mocks = vi.hoisted(() => ({
  language: 'en',
  enabled: true,
  dispatch: vi.fn(),
  checkText: vi.fn(),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        integrations: {
          languageToolEnabled: mocks.enabled,
          languageToolBaseUrl: 'http://localhost:8010',
        },
        advancedEditor: { customDictionary: [] },
        privacy: { localStorageOnly: true },
      },
      project: { present: { data: { manuscript: [{ id: 'sec1', content: 'She go home.' }] } } },
    }),
}));

vi.mock('../../contexts/WriterViewContext', () => ({
  useWriterViewContext: () => ({ selectedSectionId: 'sec1' }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) => (opts?.count != null ? `${k}:${opts.count}` : k),
    language: mocks.language,
  }),
}));

vi.mock('../../services/languageToolClient', () => ({
  assertLanguageToolAllowed: vi.fn(),
}));

vi.mock('../../services/languageToolService', () => ({
  checkText: mocks.checkText,
  applyMatchReplacement: vi.fn(() => 'She goes home.'),
}));

import { GrammarCheckPanel } from '../../components/writing/GrammarCheckPanel';

function match(over: Partial<LanguageToolMatch> = {}): LanguageToolMatch {
  return {
    offset: 4,
    length: 2,
    message: 'Subject-verb agreement',
    shortMessage: 'Agreement',
    replacements: ['goes'],
    ruleId: 'AGREEMENT',
    category: 'GRAMMAR',
    categoryName: 'Grammar',
    matchedText: 'go',
    isSpelling: false,
    ...over,
  };
}

describe('GrammarCheckPanel', () => {
  beforeEach(() => {
    mocks.language = 'en';
    mocks.enabled = true;
    mocks.dispatch.mockReset();
    mocks.checkText.mockReset();
    mocks.checkText.mockResolvedValue({ matches: [match()], status: 'ok' });
  });

  it('runs a check and lists the issue with a suggestion', async () => {
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));

    await waitFor(() => expect(mocks.checkText).toHaveBeenCalledOnce());
    expect(await screen.findByText('Subject-verb agreement')).toBeTruthy();
    expect(screen.getByText('goes')).toBeTruthy();
    expect(screen.getByText('writer.grammar.issuesFound:1')).toBeTruthy();
  });

  it('applies a suggestion → dispatches a section update and re-checks', async () => {
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    await screen.findByText('goes');

    await userEvent.click(screen.getByText('goes'));
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalled());
    // Re-check after apply (offsets shifted): checkText called a second time.
    await waitFor(() => expect(mocks.checkText).toHaveBeenCalledTimes(2));
  });

  it('removes an issue from the list when ignored', async () => {
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    await screen.findByText('Subject-verb agreement');

    await userEvent.click(screen.getByText('writer.grammar.ignore'));
    await waitFor(() => expect(screen.queryByText('Subject-verb agreement')).toBeNull());
  });

  it('hides the feature for a LanguageTool-unsupported locale (Korean)', () => {
    mocks.language = 'ko';
    render(<GrammarCheckPanel />);
    expect(screen.getByText('writer.grammar.unsupported')).toBeTruthy();
    expect(screen.queryByText('writer.grammar.checkButton')).toBeNull();
  });

  it('shows the enable hint when the integration is disabled', () => {
    mocks.enabled = false;
    render(<GrammarCheckPanel />);
    expect(screen.getByText('writer.grammar.disabled')).toBeTruthy();
  });

  it('shows the no-issues message on a clean check', async () => {
    mocks.checkText.mockResolvedValue({ matches: [], status: 'ok' });
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    expect(await screen.findByText('writer.grammar.noIssues')).toBeTruthy();
  });

  it('shows the offline message when the server is unreachable', async () => {
    mocks.checkText.mockResolvedValue({ matches: [], status: 'offline' });
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    expect(await screen.findByText('writer.grammar.offline')).toBeTruthy();
  });

  it('shows the error message on a server error', async () => {
    mocks.checkText.mockResolvedValue({ matches: [], status: 'error' });
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    expect(await screen.findByText('writer.grammar.error')).toBeTruthy();
  });

  it('offers add-to-dictionary for a spelling match and no-suggestions when empty', async () => {
    mocks.checkText.mockResolvedValue({
      matches: [match({ isSpelling: true, replacements: [], matchedText: 'Gandalf' })],
      status: 'ok',
    });
    render(<GrammarCheckPanel />);
    await userEvent.click(screen.getByText('writer.grammar.checkButton'));
    expect(await screen.findByText('writer.grammar.addToDictionary')).toBeTruthy();
    expect(screen.getByText('writer.grammar.noSuggestions')).toBeTruthy();
  });
});
