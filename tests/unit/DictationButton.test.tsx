/**
 * Tests for components/ui/DictationButton.tsx
 * QNBS-v3 (#344): extracted from Textarea.tsx's default-variant mic button so overlay consumers can render dictation as a sibling.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToggleListening = vi.fn();
const mockSetTranscript = vi.fn();

let mockIsListening = false;
let mockTranscript = '';

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: mockIsListening,
    transcript: mockTranscript,
    toggleListening: mockToggleListening,
    setTranscript: mockSetTranscript,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { DictationButton } from '../../components/ui/DictationButton';

describe('DictationButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsListening = false;
    mockTranscript = '';
  });

  it('renders a microphone button', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<DictationButton targetRef={ref} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls toggleListening when clicked', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    render(<DictationButton targetRef={ref} />);
    await user.click(screen.getByRole('button'));
    expect(mockToggleListening).toHaveBeenCalledTimes(1);
  });

  it('shows "stop" aria-label when listening', () => {
    mockIsListening = true;
    const ref = createRef<HTMLTextAreaElement>();
    render(<DictationButton targetRef={ref} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('common.dictation.stop');
  });

  it('injects the transcript into the target textarea and clears it', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'existing text';
    document.body.appendChild(textarea);
    const ref = { current: textarea };
    mockTranscript = 'dictated words';

    const inputListener = vi.fn();
    textarea.addEventListener('input', inputListener);

    render(<DictationButton targetRef={ref} />);

    expect(textarea.value).toBe('existing text dictated words');
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(mockSetTranscript).toHaveBeenCalledWith('');

    document.body.removeChild(textarea);
  });

  it('does not throw when the target ref is not yet attached', () => {
    mockTranscript = 'dictated words';
    const ref = createRef<HTMLTextAreaElement>();
    expect(() => render(<DictationButton targetRef={ref} />)).not.toThrow();
  });
});
