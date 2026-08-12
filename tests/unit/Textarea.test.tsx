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
let mockSettings = {
  editorFont: 'serif' as string,
  fontSize: 16,
  lineSpacing: 1.6,
  customFont: undefined as { name: string } | undefined,
};
let mockDir: 'ltr' | 'rtl' = 'ltr';

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: mockIsListening,
    transcript: mockTranscript,
    toggleListening: mockToggleListening,
    setTranscript: mockSetTranscript,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en', dir: mockDir }),
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
    mockSettings = { editorFont: 'serif', fontSize: 16, lineSpacing: 1.6, customFont: undefined };
    mockDir = 'ltr';
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
    mockSettings = { editorFont: 'serif', fontSize: 18, lineSpacing: 1.8, customFont: undefined };
    render(<Textarea data-testid="ta" />);
    const textarea = screen.getByTestId('ta');
    expect(textarea.style.fontFamily).toContain('serif');
  });

  it('uses the configured custom font name when editorFont is "custom"', () => {
    mockSettings = {
      editorFont: 'custom',
      fontSize: 16,
      lineSpacing: 1.6,
      customFont: { name: 'My Special Font' },
    };
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').style.fontFamily).toContain('My Special Font');
  });

  it('falls back to the monospace stack when editorFont is "custom" but no custom font is set', () => {
    mockSettings = { editorFont: 'custom', fontSize: 16, lineSpacing: 1.6, customFont: undefined };
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').style.fontFamily).toContain('JetBrains Mono');
  });

  it('sets the dir attribute to match the active text direction', () => {
    mockDir = 'rtl';
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').getAttribute('dir')).toBe('rtl');
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

  // QNBS-v3 (#341): 'overlay' renders a real, focusable textarea meant to sit invisibly over a separate visible mirror layer — no glass/blur/shadow/reserved padding, no mic button.
  describe('variant="overlay"', () => {
    it('does not render the microphone button', () => {
      render(<Textarea variant="overlay" data-testid="ta" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('does not include backdrop-blur or the glass background class', () => {
      render(<Textarea variant="overlay" data-testid="ta" />);
      const className = screen.getByTestId('ta').className;
      expect(className).not.toContain('backdrop-blur');
      expect(className).not.toContain('bg-[var(--glass-bg)]');
    });

    it('does not include the reserved bottom padding for the mic button', () => {
      render(<Textarea variant="overlay" data-testid="ta" />);
      expect(screen.getByTestId('ta').className).not.toContain('pb-12');
    });

    it('still applies the resolved font family from settings', () => {
      mockSettings = { editorFont: 'serif', fontSize: 18, lineSpacing: 1.8 };
      render(<Textarea variant="overlay" data-testid="ta" />);
      expect(screen.getByTestId('ta').style.fontFamily).toContain('Merriweather');
    });

    it('retains the focus-visible ring for keyboard accessibility', () => {
      render(<Textarea variant="overlay" data-testid="ta" />);
      expect(screen.getByTestId('ta').className).toContain('focus-visible:ring-2');
      expect(screen.getByTestId('ta').className).toContain(
        'focus-visible:ring-[var(--sc-ring-focus)]',
      );
    });
  });

  describe('variant="default" (unchanged regression guard)', () => {
    it('still includes backdrop-blur and renders the mic button', () => {
      render(<Textarea data-testid="ta" />);
      expect(screen.getByTestId('ta').className).toContain('backdrop-blur-md');
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });
});
