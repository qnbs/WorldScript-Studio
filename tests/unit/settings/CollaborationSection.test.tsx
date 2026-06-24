/**
 * Tests for components/settings/CollaborationSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + Textarea; tests toggles and signaling URL textarea.
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

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      collaboration: {
        webrtcSignalingUrls: ['wss://signaling.example.com'],
      },
    },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

vi.mock('../../../services/collaborationService', () => ({
  DEFAULT_WEBRTC_SIGNALING_URLS: ['wss://default.signaling.com'],
}));

// Textarea uses useAppSelector — mock it
vi.mock('../../../components/ui/Textarea', () => ({
  Textarea: vi.fn(
    ({
      value,
      onChange,
      placeholder,
      ...rest
    }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea value={value} onChange={onChange} placeholder={placeholder} {...rest} />
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { CollaborationSection } from '../../../components/settings/CollaborationSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaborationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the collaboration title', () => {
    render(<CollaborationSection />);
    expect(screen.getByText('settings.collaboration.title')).toBeInTheDocument();
  });

  it('renders the security warning alert', () => {
    render(<CollaborationSection />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('collab.securityWarning')).toBeInTheDocument();
  });

  it('renders the signaling URLs textarea with current value', () => {
    render(<CollaborationSection />);
    expect(screen.getByDisplayValue('wss://signaling.example.com')).toBeInTheDocument();
  });

  it('calls handleSettingChange when signaling URL textarea changes', async () => {
    const user = userEvent.setup();
    render(<CollaborationSection />);
    const textarea = screen.getByDisplayValue('wss://signaling.example.com');
    await user.clear(textarea);
    await user.type(textarea, 'wss://new.example.com');
    expect(mockHandleSettingChange).toHaveBeenCalled();
  });

  it('renders the signaling URLs label', () => {
    render(<CollaborationSection />);
    expect(screen.getByText('settings.collaboration.webrtcSignalingUrls')).toBeInTheDocument();
  });
});
