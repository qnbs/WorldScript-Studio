/**
 * Tests for components/character-interviews/InterviewQuestionBar.tsx
 * QNBS-v3: Mocks CharacterInterviewsViewContext; tests suggestion chips, custom input, send.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendQuestion = vi.fn();
let mockSelectedInterview: {
  id: string;
  archetype: string;
  messages: { id: string; role: 'user' | 'ai'; content: string }[];
} | null = null;
let mockIsStreaming = false;

vi.mock('../../contexts/CharacterInterviewsViewContext', () => ({
  useCharacterInterviewsViewContext: () => ({
    selectedInterview: mockSelectedInterview,
    sendQuestion: mockSendQuestion,
    characters: [],
    selectedCharacterId: null,
    selectedInterviewId: null,
    selectedCharacter: undefined,
    selectedArchetype: null,
    isEnabled: true,
    isStreaming: mockIsStreaming,
    interviews: [],
    hasAiKey: true,
    selectCharacter: vi.fn(),
    selectInterview: vi.fn(),
    selectArchetype: vi.fn(),
    startNewInterview: vi.fn(),
    deleteInterview: vi.fn(),
    stopStreaming: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/characterInterviewTemplates', () => ({
  getQuestionsForArchetype: (archetype: string) => {
    if (archetype === 'hero') {
      return [
        { id: 'q1', question: 'What is your greatest fear?' },
        { id: 'q2', question: 'What drives you?' },
      ];
    }
    return [];
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { InterviewQuestionBar } from '../../components/character-interviews/InterviewQuestionBar';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InterviewQuestionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedInterview = null;
    mockIsStreaming = false;
  });

  it('renders nothing when no interview is selected', () => {
    const { container } = render(<InterviewQuestionBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders suggestion chips when archetype has questions', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    expect(screen.getByText('What is your greatest fear?')).toBeInTheDocument();
    expect(screen.getByText('What drives you?')).toBeInTheDocument();
  });

  it('renders the custom question input', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    expect(
      screen.getByRole('textbox', { name: 'characterInterviews.customQuestion' }),
    ).toBeInTheDocument();
  });

  it('renders the send button', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    expect(screen.getByText('characterInterviews.sendQuestion')).toBeInTheDocument();
  });

  it('calls sendQuestion when suggestion chip is clicked', async () => {
    const user = userEvent.setup();
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    await user.click(screen.getByText('What is your greatest fear?'));
    expect(mockSendQuestion).toHaveBeenCalledWith('What is your greatest fear?');
  });

  it('sends custom question and clears input on submit click', async () => {
    const user = userEvent.setup();
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    const input = screen.getByRole('textbox', { name: 'characterInterviews.customQuestion' });
    await user.type(input, 'My custom question');
    await user.click(screen.getByText('characterInterviews.sendQuestion'));
    expect(mockSendQuestion).toHaveBeenCalledWith('My custom question');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('sends custom question on Enter key', async () => {
    const user = userEvent.setup();
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    const input = screen.getByRole('textbox', { name: 'characterInterviews.customQuestion' });
    await user.type(input, 'My question{Enter}');
    expect(mockSendQuestion).toHaveBeenCalledWith('My question');
  });

  it('disables send when streaming', () => {
    mockIsStreaming = true;
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewQuestionBar />);
    const sendBtn = screen.getByText('characterInterviews.sendQuestion').closest('button');
    expect(sendBtn).toBeDisabled();
  });

  it('filters already-asked questions from suggestions', () => {
    mockSelectedInterview = {
      id: 'iv-1',
      archetype: 'hero',
      messages: [{ id: 'm1', role: 'user', content: 'What is your greatest fear?' }],
    };
    render(<InterviewQuestionBar />);
    expect(screen.queryByText('What is your greatest fear?')).not.toBeInTheDocument();
    expect(screen.getByText('What drives you?')).toBeInTheDocument();
  });

  it('hides suggestions section when no archetype questions exist', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'unknown', messages: [] };
    render(<InterviewQuestionBar />);
    expect(screen.queryByText('characterInterviews.suggestedQuestions')).not.toBeInTheDocument();
  });
});
