/**
 * Tests for components/settings/PrivacySection.tsx
 * QNBS-v3: Mocks SettingsViewContext; covers privacy toggles + B-1 encryption card.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange, mockSetPassphraseModal } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
  mockSetPassphraseModal: vi.fn(),
}));

const makeCtx = (overrides?: Record<string, unknown>) => ({
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
  featureFlags: { enableIdbAtRestEncryption: false },
  encryptionReady: false,
  passphraseModal: 'closed' as const,
  setPassphraseModal: mockSetPassphraseModal,
  handlePassphraseConfirm: vi.fn(),
  handleSettingChange: mockHandleSettingChange,
  ...overrides,
});

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: vi.fn(() => makeCtx()),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PrivacySection } from '../../../components/settings/PrivacySection';
import { useSettingsViewContext } from '../../../contexts/SettingsViewContext';

const mockCtx = vi.mocked(useSettingsViewContext);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrivacySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.mockReturnValue(makeCtx() as unknown as ReturnType<typeof useSettingsViewContext>);
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

  // B-1 encryption card
  it('shows encryption disabled status when flag is off', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionDisabledStatus')).toBeInTheDocument();
  });

  it('shows "Set Passphrase" button when encryption is disabled', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionSetAction')).toBeInTheDocument();
  });

  it('opens set passphrase modal on button click', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionSetAction'));
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('set');
  });

  it('shows active status and change/disable buttons when encryption is on and ready', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionActiveStatus')).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionChangeAction')).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionDisableAction')).toBeInTheDocument();
  });

  it('shows locked status when encryption is on but key not in session', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: false,
      }) as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionLockedStatus')).toBeInTheDocument();
  });

  it('opens change modal when change action is clicked', async () => {
    const user = userEvent.setup();
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionChangeAction'));
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('change');
  });

  it('opens disable modal when disable action is clicked', async () => {
    const user = userEvent.setup();
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionDisableAction'));
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('disable');
  });
});
