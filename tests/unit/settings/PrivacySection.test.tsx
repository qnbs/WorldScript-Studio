/**
 * Tests for components/settings/PrivacySection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests all five privacy toggles.
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
      privacy: {
        analyticsEnabled: true,
        crashReporting: false,
        dataEncryption: true,
        localStorageOnly: false,
        shareUsageData: false,
      },
    },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PrivacySection } from '../../../components/settings/PrivacySection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrivacySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the privacy title', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.title')).toBeInTheDocument();
  });

  it('renders analytics enabled toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.analyticsEnabled')).toBeInTheDocument();
  });

  it('renders crash reporting toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.crashReporting')).toBeInTheDocument();
  });

  it('renders data encryption toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.dataEncryption')).toBeInTheDocument();
  });

  it('renders local storage only toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.localStorageOnly')).toBeInTheDocument();
  });

  it('renders share usage data toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.shareUsageData')).toBeInTheDocument();
  });

  it('renders five toggles total', () => {
    render(<PrivacySection />);
    expect(screen.getAllByRole('switch').length).toBe(5);
  });

  it('analytics toggle calls handleSettingChange when clicked', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);
    await user.click(screen.getByRole('switch', { name: 'settings.privacy.analyticsEnabled' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'privacy',
      expect.objectContaining({ analyticsEnabled: false }),
    );
  });
});
