/**
 * Tests for Input and Textarea UI components (both use useSpeechRecognition + useTranslation).
 * QNBS-v3: Both components have identical dictation toggle pattern — tested together.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted so factories can reference them)
// ---------------------------------------------------------------------------

const mockToggleListening = vi.fn();
const mockSetTranscript = vi.fn();
const mockSpeechRec = vi.fn(() => ({
  isListening: false,
  transcript: '',
  toggleListening: mockToggleListening,
  setTranscript: mockSetTranscript,
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => mockSpeechRec(),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.5,
        accessibility: { liveRegionVerbosity: 'full' },
      },
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

import { Input } from '../../components/ui/Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('forwards ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('shows dictation start button when not listening', () => {
    render(<Input />);
    expect(screen.getByRole('button', { name: 'common.dictation.start' })).toBeTruthy();
  });

  it('shows dictation stop button when listening', () => {
    mockSpeechRec.mockReturnValueOnce({
      isListening: true,
      transcript: '',
      toggleListening: mockToggleListening,
      setTranscript: mockSetTranscript,
    });
    render(<Input />);
    expect(screen.getByRole('button', { name: 'common.dictation.stop' })).toBeTruthy();
  });

  it('calls toggleListening when dictation button is clicked', () => {
    render(<Input />);
    fireEvent.click(screen.getByRole('button', { name: 'common.dictation.start' }));
    expect(mockToggleListening).toHaveBeenCalledOnce();
  });

  it('passes value and onChange through', () => {
    const onChange = vi.fn();
    render(<Input value="test value" onChange={onChange} readOnly={false} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('test value');
  });
});

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

import { Textarea } from '../../components/ui/Textarea';

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });

  it('shows dictation start button when not listening', () => {
    render(<Textarea />);
    expect(screen.getByRole('button', { name: 'common.dictation.start' })).toBeTruthy();
  });

  it('calls toggleListening when button is clicked', () => {
    render(<Textarea />);
    fireEvent.click(screen.getByRole('button', { name: 'common.dictation.start' }));
    expect(mockToggleListening).toHaveBeenCalled();
  });

  it('applies value prop', () => {
    const onChange = vi.fn();
    render(<Textarea value="long text" onChange={onChange} readOnly={false} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('long text');
  });

  it('applies editor font styles from settings', () => {
    const { container } = render(<Textarea />);
    const ta = container.querySelector('textarea');
    expect(ta?.style.fontFamily).toContain('Merriweather');
  });
});
