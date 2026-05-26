/**
 * Tests for components/voice/VoiceIndicator.tsx
 * QNBS-v3: Covers enabled/disabled states and mode-based rendering.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockMode = 'inactive';
let mockEnabled = false;
let mockTranscript = '';

vi.mock('../../hooks/useVoice', () => ({
  useVoice: () => ({
    mode: mockMode,
    enabled: mockEnabled,
    transcript: mockTranscript,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { VoiceIndicator } from '../../components/voice/VoiceIndicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMode = 'inactive';
    mockEnabled = false;
    mockTranscript = '';
  });

  it('renders nothing when voice is not enabled', () => {
    const { container } = render(<VoiceIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders status element when enabled', () => {
    mockEnabled = true;
    render(<VoiceIndicator />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the current mode text (inactive)', () => {
    mockEnabled = true;
    mockMode = 'inactive';
    render(<VoiceIndicator />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('shows listening mode text', () => {
    mockEnabled = true;
    mockMode = 'listening';
    render(<VoiceIndicator />);
    expect(screen.getByText('listening')).toBeInTheDocument();
  });

  it('indicator dot has animate-pulse class when listening', () => {
    mockEnabled = true;
    mockMode = 'listening';
    const { container } = render(<VoiceIndicator />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('indicator dot has no animate-pulse class when processing', () => {
    mockEnabled = true;
    mockMode = 'processing';
    const { container } = render(<VoiceIndicator />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeNull();
  });

  it('shows transcript when mode is not inactive and transcript is set', () => {
    mockEnabled = true;
    mockMode = 'dictating';
    mockTranscript = 'hello world';
    render(<VoiceIndicator />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('does not show transcript when mode is inactive', () => {
    mockEnabled = true;
    mockMode = 'inactive';
    mockTranscript = 'hello world';
    render(<VoiceIndicator />);
    expect(screen.queryByText('hello world')).not.toBeInTheDocument();
  });

  it('has aria-label with current voice status', () => {
    mockEnabled = true;
    mockMode = 'speaking';
    render(<VoiceIndicator />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('speaking');
  });
});
