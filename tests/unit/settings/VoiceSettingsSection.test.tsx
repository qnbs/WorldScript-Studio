/**
 * Tests for components/settings/VoiceSettingsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests master toggle, conditional sections.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
}));

let mockVoiceEnabled = false;

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      voice: {
        enabled: mockVoiceEnabled,
        activationMode: 'manual',
        feedbackLevel: 'standard',
        ttsMuted: false,
        dictationAutoPunctuation: true,
        allowCloudSttFallback: false,
        listeningTimeoutSeconds: 10,
      },
      language: 'en',
      theme: 'dark',
    },
    handleSettingChange: mockHandleSettingChange,
    handleResetSettings: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { VoiceSettingsSection } from '../../../components/settings/VoiceSettingsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceEnabled = false;
  });

  it('renders the voice settings heading', () => {
    render(<VoiceSettingsSection />);
    expect(screen.getByText('settings.voice.title')).toBeInTheDocument();
  });

  it('renders the master enable toggle', () => {
    render(<VoiceSettingsSection />);
    expect(screen.getByText('settings.voice.enableLabel')).toBeInTheDocument();
  });

  it('does not show advanced settings when voice is disabled', () => {
    render(<VoiceSettingsSection />);
    expect(screen.queryByText('settings.voice.activationMode')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.voice.feedbackLevel')).not.toBeInTheDocument();
  });

  it('calls handleSettingChange when master toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<VoiceSettingsSection />);
    await user.click(screen.getByRole('switch', { name: 'settings.voice.enableLabel' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'voice',
      expect.objectContaining({ enabled: true }),
    );
  });

  it('shows advanced settings when voice is enabled', () => {
    mockVoiceEnabled = true;
    render(<VoiceSettingsSection />);
    expect(screen.getByText('settings.voice.activationMode')).toBeInTheDocument();
    expect(screen.getByText('settings.voice.feedbackLevel')).toBeInTheDocument();
  });

  it('shows privacy notice when voice is enabled', () => {
    mockVoiceEnabled = true;
    render(<VoiceSettingsSection />);
    expect(screen.getByText('settings.voice.privacyNotice')).toBeInTheDocument();
  });

  it('shows TTS muted toggle when voice is enabled', () => {
    mockVoiceEnabled = true;
    render(<VoiceSettingsSection />);
    expect(screen.getByText('settings.voice.ttsMuted')).toBeInTheDocument();
  });

  it('shows listening timeout slider when voice is enabled', () => {
    mockVoiceEnabled = true;
    render(<VoiceSettingsSection />);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('calls handleSettingChange when activation mode changes', async () => {
    const user = userEvent.setup();
    mockVoiceEnabled = true;
    render(<VoiceSettingsSection />);
    const select = screen.getAllByRole('combobox')[0]!;
    await user.selectOptions(select, 'pushToTalk');
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'voice',
      expect.objectContaining({ activationMode: 'pushToTalk' }),
    );
  });
});
