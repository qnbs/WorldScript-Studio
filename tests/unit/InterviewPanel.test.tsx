/**
 * Tests for components/character-interviews/InterviewPanel.tsx
 * QNBS-v3: Mocks CharacterInterviewsViewContext; tests message display, streaming, stop button.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStopStreaming = vi.fn();
const mockSendQuestion = vi.fn();
let mockSelectedInterview: {
  id: string;
  archetype: string;
  messages: { id: string; role: 'user' | 'ai'; content: string }[];
} | null = null;
let mockIsStreaming = false;
let mockHasAiKey = true;
let mockSelectedCharacter: { name: string } | undefined;

vi.mock('../../contexts/CharacterInterviewsViewContext', () => ({
  useCharacterInterviewsViewContext: () => ({
    selectedInterview: mockSelectedInterview,
    selectedCharacter: mockSelectedCharacter,
    isStreaming: mockIsStreaming,
    stopStreaming: mockStopStreaming,
    hasAiKey: mockHasAiKey,
    characters: [],
    selectedCharacterId: null,
    selectedInterviewId: null,
    selectedArchetype: null,
    isEnabled: true,
    interviews: [],
    selectCharacter: vi.fn(),
    selectInterview: vi.fn(),
    selectArchetype: vi.fn(),
    startNewInterview: vi.fn(),
    deleteInterview: vi.fn(),
    sendQuestion: mockSendQuestion,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// Mock InterviewQuestionBar to isolate InterviewPanel tests
vi.mock('../../components/character-interviews/InterviewQuestionBar', () => ({
  InterviewQuestionBar: () => <div data-testid="question-bar" />,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { InterviewPanel } from '../../components/character-interviews/InterviewPanel';

// jsdom does not implement scrollIntoView
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InterviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedInterview = null;
    mockIsStreaming = false;
    mockHasAiKey = true;
    mockSelectedCharacter = undefined;
  });

  it('renders nothing when no interview is selected', () => {
    const { container } = render(<InterviewPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('shows no-AI-key message when hasAiKey is false and interview exists', () => {
    mockHasAiKey = false;
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewPanel />);
    expect(screen.getByText('characterInterviews.noAiKey')).toBeInTheDocument();
  });

  it('renders messages when interview has messages', () => {
    mockSelectedInterview = {
      id: 'iv-1',
      archetype: 'hero',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello character' },
        { id: 'm2', role: 'ai', content: 'Hello user' },
      ],
    };
    render(<InterviewPanel />);
    expect(screen.getByText('Hello character')).toBeInTheDocument();
    expect(screen.getByText('Hello user')).toBeInTheDocument();
  });

  it('shows "thinking" indicator when streaming', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    mockIsStreaming = true;
    render(<InterviewPanel />);
    expect(screen.getByText('characterInterviews.thinking')).toBeInTheDocument();
  });

  it('shows stop button when streaming', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    mockIsStreaming = true;
    render(<InterviewPanel />);
    expect(
      screen.getByRole('button', { name: 'characterInterviews.stopGeneration' }),
    ).toBeInTheDocument();
  });

  it('calls stopStreaming when stop button is clicked', async () => {
    const user = userEvent.setup();
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    mockIsStreaming = true;
    render(<InterviewPanel />);
    await user.click(screen.getByRole('button', { name: 'characterInterviews.stopGeneration' }));
    expect(mockStopStreaming).toHaveBeenCalledTimes(1);
  });

  it('shows user label as messageRoleUser', () => {
    mockSelectedInterview = {
      id: 'iv-1',
      archetype: 'hero',
      messages: [{ id: 'm1', role: 'user', content: 'My question' }],
    };
    render(<InterviewPanel />);
    expect(screen.getByText('characterInterviews.messageRoleUser')).toBeInTheDocument();
  });

  it('shows character name as AI label when character is set', () => {
    mockSelectedCharacter = { name: 'Gandalf' };
    mockSelectedInterview = {
      id: 'iv-1',
      archetype: 'mentor',
      messages: [{ id: 'm2', role: 'ai', content: 'I am Gandalf' }],
    };
    render(<InterviewPanel />);
    expect(screen.getByText('Gandalf')).toBeInTheDocument();
  });

  it('renders the question bar', () => {
    mockSelectedInterview = { id: 'iv-1', archetype: 'hero', messages: [] };
    render(<InterviewPanel />);
    expect(screen.getByTestId('question-bar')).toBeInTheDocument();
  });
});
