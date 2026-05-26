/**
 * Tests for components/writing/AiScratchpad.tsx
 * QNBS-v3: Mocks WriterViewContext + useTTS; tests result display, history nav, accept, TTS.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleAccept = vi.fn();
const mockHandleGenerate = vi.fn();
const mockHandleNavigateHistory = vi.fn();
const mockHandleUpdateScratchpad = vi.fn();
const mockDispatch = vi.fn();

let mockWriterState = {
  generationHistory: [] as string[],
  activeHistoryIndex: 0,
  isLoading: false,
  activeTool: 'continue' as string,
  tone: '',
  style: '',
  useRagContext: false,
  lastRagChunkCount: 0,
  selection: { start: 0, end: 0, text: '' },
  selectedSectionId: null as string | null,
};

const mockSpeak = vi.fn();
const mockStop = vi.fn();
let mockIsSpeaking = false;
let mockTtsSupported = true;

vi.mock('../../contexts/WriterViewContext', () => ({
  useWriterViewContext: () => ({
    writerState: mockWriterState,
    dispatch: mockDispatch,
    handleAccept: mockHandleAccept,
    handleGenerate: mockHandleGenerate,
    handleNavigateHistory: mockHandleNavigateHistory,
    handleUpdateScratchpad: mockHandleUpdateScratchpad,
    isGenerateDisabled: vi.fn().mockReturnValue(false),
    project: { manuscript: [], title: 'Test', id: 'p1' },
    selectedSectionId: null,
    handleContentChange: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// Textarea uses useAppSelector internally; mock it to avoid needing a Redux store
vi.mock('../../components/ui/Textarea', () => ({
  Textarea: React.forwardRef(
    (
      props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
      ref: React.Ref<HTMLTextAreaElement>,
    ) => <textarea ref={ref} {...props} />,
  ),
}));

vi.mock('../../hooks/useTTS', () => ({
  useTTS: () => ({
    speak: mockSpeak,
    stop: mockStop,
    isSpeaking: mockIsSpeaking,
    isSupported: mockTtsSupported,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { AiScratchpad } from '../../components/writing/AiScratchpad';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiScratchpad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSpeaking = false;
    mockTtsSupported = true;
    mockWriterState = {
      generationHistory: [],
      activeHistoryIndex: 0,
      isLoading: false,
      activeTool: 'continue',
      tone: '',
      style: '',
      useRagContext: false,
      lastRagChunkCount: 0,
      selection: { start: 0, end: 0, text: '' },
      selectedSectionId: null,
    };
  });

  it('renders the result heading', () => {
    render(<AiScratchpad />);
    expect(screen.getByText('writer.studio.result.title')).toBeInTheDocument();
  });

  it('renders the textarea placeholder when no result', () => {
    render(<AiScratchpad />);
    expect(screen.getByPlaceholderText('writer.studio.result.placeholder')).toBeInTheDocument();
  });

  it('shows current result in textarea', () => {
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['AI generated text'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toBe('AI generated text');
  });

  it('shows spinner overlay when loading with empty result', () => {
    mockWriterState = { ...mockWriterState, isLoading: true, generationHistory: [''] };
    render(<AiScratchpad />);
    expect(screen.getByText('Writing...')).toBeInTheDocument();
  });

  it('disables previous button when at first history item', () => {
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['result'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    const prevBtn = screen.getByRole('button', { name: 'writer.studio.result.prev' });
    expect(prevBtn).toBeDisabled();
  });

  it('enables previous button when not at first history item', () => {
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['first', 'second'],
      activeHistoryIndex: 1,
    };
    render(<AiScratchpad />);
    const prevBtn = screen.getByRole('button', { name: 'writer.studio.result.prev' });
    expect(prevBtn).not.toBeDisabled();
  });

  it('calls handleNavigateHistory with prev when prev button clicked', async () => {
    const user = userEvent.setup();
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['first', 'second'],
      activeHistoryIndex: 1,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByRole('button', { name: 'writer.studio.result.prev' }));
    expect(mockHandleNavigateHistory).toHaveBeenCalledWith('prev');
  });

  it('calls handleNavigateHistory with next when next button clicked', async () => {
    const user = userEvent.setup();
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['first', 'second'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByRole('button', { name: 'writer.studio.result.next' }));
    expect(mockHandleNavigateHistory).toHaveBeenCalledWith('next');
  });

  it('calls handleAccept(insert) when insert button is clicked for continue tool', async () => {
    const user = userEvent.setup();
    mockWriterState = {
      ...mockWriterState,
      activeTool: 'continue',
      generationHistory: ['result text'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByText('writer.studio.result.insert'));
    expect(mockHandleAccept).toHaveBeenCalledWith('insert');
  });

  it('calls handleAccept(replace) when replace button is clicked for improve tool', async () => {
    const user = userEvent.setup();
    mockWriterState = {
      ...mockWriterState,
      activeTool: 'improve',
      generationHistory: ['result text'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByText('writer.studio.result.replace'));
    expect(mockHandleAccept).toHaveBeenCalledWith('replace');
  });

  it('shows TTS start button when TTS is supported and not speaking', () => {
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['result'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    expect(screen.getByRole('button', { name: 'writer.tts.start' })).toBeInTheDocument();
  });

  it('calls speak when TTS start button is clicked', async () => {
    const user = userEvent.setup();
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['result text'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByRole('button', { name: 'writer.tts.start' }));
    expect(mockSpeak).toHaveBeenCalledWith('result text', expect.any(String));
  });

  it('shows stop TTS button when speaking', () => {
    mockIsSpeaking = true;
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['result'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    expect(screen.getByRole('button', { name: 'writer.tts.stop' })).toBeInTheDocument();
  });

  it('calls stop when stop TTS button is clicked', async () => {
    const user = userEvent.setup();
    mockIsSpeaking = true;
    mockWriterState = {
      ...mockWriterState,
      generationHistory: ['result'],
      activeHistoryIndex: 0,
    };
    render(<AiScratchpad />);
    await user.click(screen.getByRole('button', { name: 'writer.tts.stop' }));
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});
