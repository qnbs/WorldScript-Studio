/**
 * Tests for components/ui/Input.tsx
 * QNBS-v3: Covers render, voice mic button toggle, speech recognition integration.
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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { Input } from '../../components/ui/Input';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsListening = false;
    mockTranscript = '';
  });

  it('renders an <input> element', () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText('Type here')).toBeInTheDocument();
  });

  it('renders the microphone button', () => {
    render(<Input />);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
  });

  it('microphone button has aria-label for start dictation when not listening', () => {
    mockIsListening = false;
    render(<Input />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe('common.dictation.start');
  });

  it('microphone button has aria-label for stop dictation when listening', () => {
    mockIsListening = true;
    render(<Input />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe('common.dictation.stop');
  });

  it('calls toggleListening when mic button is clicked', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.click(screen.getByRole('button'));
    expect(mockToggleListening).toHaveBeenCalledTimes(1);
  });

  it('forwards additional props to the <input>', () => {
    render(<Input data-testid="my-input" type="email" />);
    const input = screen.getByTestId('my-input');
    expect(input.getAttribute('type')).toBe('email');
  });

  it('forwards ref to the underlying <input>', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} placeholder="ref-test" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('applies custom className', () => {
    render(<Input className="custom-class" data-testid="styled-input" />);
    const input = screen.getByTestId('styled-input');
    expect(input.className).toContain('custom-class');
  });

  it('renders animate-pulse class on mic button when listening', () => {
    mockIsListening = true;
    render(<Input />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('animate-pulse');
  });
});
