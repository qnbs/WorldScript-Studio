/**
 * Tests for components/ui/Textarea.tsx
 * QNBS-v3: Covers render, voice mic button, font settings application, forwardRef.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToggleListening = vi.fn();
const mockSetTranscript = vi.fn();

let mockIsListening = false;
let mockTranscript = '';
let mockSettings = { editorFont: 'serif' as string, fontSize: 16, lineSpacing: 1.6 };

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: mockIsListening,
    transcript: mockTranscript,
    toggleListening: mockToggleListening,
    setTranscript: mockSetTranscript,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) => selector({ settings: mockSettings }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { Textarea } from '../../components/ui/Textarea';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Textarea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsListening = false;
    mockTranscript = '';
    mockSettings = { editorFont: 'serif', fontSize: 16, lineSpacing: 1.6 };
  });

  it('renders a <textarea> element', () => {
    render(<Textarea placeholder="Write here" />);
    expect(screen.getByPlaceholderText('Write here')).toBeInTheDocument();
  });

  it('renders a microphone button', () => {
    render(<Textarea />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('mic button shows "stop" aria-label when listening', () => {
    mockIsListening = true;
    render(<Textarea />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('common.dictation.stop');
  });

  it('mic button shows "start" aria-label when not listening', () => {
    mockIsListening = false;
    render(<Textarea />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('common.dictation.start');
  });

  it('calls toggleListening when mic button is clicked', async () => {
    const user = userEvent.setup();
    render(<Textarea />);
    await user.click(screen.getByRole('button'));
    expect(mockToggleListening).toHaveBeenCalledTimes(1);
  });

  it('applies serif font family from settings', () => {
    mockSettings = { editorFont: 'serif', fontSize: 18, lineSpacing: 1.8 };
    render(<Textarea data-testid="ta" />);
    const textarea = screen.getByTestId('ta');
    expect(textarea.style.fontFamily).toContain('serif');
  });

  it('forwards ref to underlying <textarea>', () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<Textarea ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });

  it('forwards custom props like rows and disabled', () => {
    render(<Textarea rows={5} disabled data-testid="ta" />);
    const textarea = screen.getByTestId('ta');
    expect(textarea.getAttribute('rows')).toBe('5');
    expect(textarea).toBeDisabled();
  });

  it('applies animate-pulse class on mic button when listening', () => {
    mockIsListening = true;
    render(<Textarea />);
    expect(screen.getByRole('button').className).toContain('animate-pulse');
  });
});
