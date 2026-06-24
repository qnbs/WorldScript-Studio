/**
 * Tests for PrivacySection.tsx and NotificationsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests render and toggle interactions.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleSettingChange = vi.fn();

const defaultSettings = {
  privacy: {
    analyticsEnabled: true,
    dataEncryption: true,
    localStorageOnly: false,
    euDataResidency: false,
  },
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: defaultSettings,
    handleSettingChange: mockHandleSettingChange,
    featureFlags: {},
    setActiveCategory: vi.fn(),
  }),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { PrivacySection } from '../../../components/settings/PrivacySection';

// ---------------------------------------------------------------------------
// PrivacySection tests
// ---------------------------------------------------------------------------

describe('PrivacySection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the privacy title', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.title')).toBeInTheDocument();
  });

  it('renders all privacy toggles', () => {
    render(<PrivacySection />);
    expect(
      screen.getByRole('switch', { name: 'settings.privacy.analyticsEnabled' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'settings.privacy.localStorageOnly' }),
    ).toBeInTheDocument();
  });

  it('analyticsEnabled toggle reflects current value', () => {
    render(<PrivacySection />);
    expect(
      screen
        .getByRole('switch', { name: 'settings.privacy.analyticsEnabled' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('calls handleSettingChange when a toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);
    // QNBS-v3: localStorageOnly replaces the removed crashReporting toggle here; the mock has it
    // off, so clicking flips it on.
    await user.click(screen.getByRole('switch', { name: 'settings.privacy.localStorageOnly' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'privacy',
      expect.objectContaining({ localStorageOnly: true }),
    );
  });
});
