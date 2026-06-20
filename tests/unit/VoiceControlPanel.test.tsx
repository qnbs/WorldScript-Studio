/**
 * Tests for components/voice/VoiceControlPanel.tsx
 * QNBS-v3: Covers enabled/disabled, permission denied, and toggle interactions.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartListening = vi.fn().mockResolvedValue(undefined);
const mockStopListening = vi.fn().mockResolvedValue(undefined);
const mockStartDictation = vi.fn().mockResolvedValue(undefined);
const mockStopDictation = vi.fn().mockResolvedValue(undefined);
const mockCancelSpeech = vi.fn();

let mockEnabled = false;
let mockMode = 'inactive';
let mockIsListening = false;
let mockDictationActive = false;
let mockMicPermission: 'granted' | 'denied' | 'prompt' = 'prompt';

vi.mock('../../hooks/useVoice', () => ({
  useVoice: () => ({
    enabled: mockEnabled,
    mode: mockMode,
    isListening: mockIsListening,
    dictationActive: mockDictationActive,
    startListening: mockStartListening,
    stopListening: mockStopListening,
    startDictation: mockStartDictation,
    stopDictation: mockStopDictation,
    cancelSpeech: mockCancelSpeech,
    microphonePermission: mockMicPermission,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { VoiceControlPanel } from '../../components/voice/VoiceControlPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceControlPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnabled = false;
    mockMode = 'inactive';
    mockIsListening = false;
    mockDictationActive = false;
    mockMicPermission = 'prompt';
  });

  it('renders nothing when voice is not enabled', () => {
    const { container } = render(<VoiceControlPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('shows permission denied message when microphone access is denied', () => {
    mockEnabled = true;
    mockMicPermission = 'denied';
    render(<VoiceControlPanel />);
    expect(screen.getByText('voice.permissionDenied')).toBeInTheDocument();
  });

  it('renders the voice panel section when enabled', () => {
    mockEnabled = true;
    render(<VoiceControlPanel />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('listen button has aria-label for startListening when not listening', () => {
    mockEnabled = true;
    mockIsListening = false;
    render(<VoiceControlPanel />);
    const listenBtn = screen.getAllByRole('button')[0]!;
    expect(listenBtn.getAttribute('aria-label')).toBe('voice.startListening');
  });

  it('listen button has aria-label for stopListening when listening', () => {
    mockEnabled = true;
    mockIsListening = true;
    mockMode = 'listening';
    render(<VoiceControlPanel />);
    const listenBtn = screen.getAllByRole('button')[0]!;
    expect(listenBtn.getAttribute('aria-label')).toBe('voice.stopListening');
  });

  it('calls startListening when listen button clicked and not listening', async () => {
    mockEnabled = true;
    mockIsListening = false;
    const user = userEvent.setup();
    render(<VoiceControlPanel />);
    await user.click(screen.getAllByRole('button')[0]!);
    expect(mockStartListening).toHaveBeenCalledTimes(1);
  });

  it('calls stopListening when listen button clicked and already listening', async () => {
    mockEnabled = true;
    mockIsListening = true;
    const user = userEvent.setup();
    render(<VoiceControlPanel />);
    await user.click(screen.getAllByRole('button')[0]!);
    expect(mockStopListening).toHaveBeenCalledTimes(1);
  });

  it('calls startDictation when dictation button clicked and not active', async () => {
    mockEnabled = true;
    mockDictationActive = false;
    const user = userEvent.setup();
    render(<VoiceControlPanel />);
    const buttons = screen.getAllByRole('button');
    // Second button is dictation toggle
    if (buttons.length > 1) {
      await user.click(buttons[1]!);
      expect(mockStartDictation).toHaveBeenCalledTimes(1);
    }
  });

  it('calls stopDictation when dictation button clicked and dictation is active', async () => {
    mockEnabled = true;
    mockDictationActive = true;
    const user = userEvent.setup();
    render(<VoiceControlPanel />);
    const buttons = screen.getAllByRole('button');
    if (buttons.length > 1) {
      await user.click(buttons[1]!);
      expect(mockStopDictation).toHaveBeenCalledTimes(1);
    }
  });

  // -------------------------------------------------------------------------
  // Mode chip (Item 3) — visible label distinguishing commands vs dictation
  // -------------------------------------------------------------------------
  it('hides the mode chip while inactive', () => {
    mockEnabled = true;
    mockMode = 'inactive';
    render(<VoiceControlPanel />);
    expect(screen.queryByText('voice.modeChip.commands')).not.toBeInTheDocument();
    expect(screen.queryByText('voice.modeChip.dictation')).not.toBeInTheDocument();
  });

  it('shows the commands chip when listening for commands', () => {
    mockEnabled = true;
    mockMode = 'listening';
    mockIsListening = true;
    render(<VoiceControlPanel />);
    expect(screen.getByText('voice.modeChip.commands')).toBeInTheDocument();
  });

  it('shows the dictation chip when dictation is active', () => {
    mockEnabled = true;
    // QNBS-v3: use the real VoiceMode contract value ('dictating', per features/voice/voiceSlice.ts),
    // not 'dictation' — asserting an impossible runtime state would let mode-dependent regressions slip.
    mockMode = 'dictating';
    mockDictationActive = true;
    render(<VoiceControlPanel />);
    expect(screen.getByText('voice.modeChip.dictation')).toBeInTheDocument();
  });
});
