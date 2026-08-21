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

// QNBS-v3: isolate desktop and web branches so the plaintext-scope warning cannot regress.
const { mockIsDesktop } = vi.hoisted(() => ({
  mockIsDesktop: { value: false },
}));

const makeCtx = (overrides?: Record<string, unknown>) => ({
  t: (k: string) => k,
  settings: {
    privacy: {
      analyticsEnabled: true,
      dataEncryption: true,
      localStorageOnly: false,
      euDataResidency: true,
    },
  },
  featureFlags: { enableIdbAtRestEncryption: false },
  encryptionReady: false,
  passphraseModal: 'closed' as const,
  setPassphraseModal: mockSetPassphraseModal,
  handlePassphraseConfirm: vi.fn(),
  handleSettingChange: mockHandleSettingChange,
  handleLockSession: vi.fn(),
  ...overrides,
});

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: vi.fn(() => makeCtx()),
}));

vi.mock('../../../services/desktopPlatform', () => ({
  desktopPlatform: {
    runtime: {
      get isDesktop() {
        return mockIsDesktop.value;
      },
    },
  },
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
    mockIsDesktop.value = false;
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

  it('renders data encryption toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.dataEncryption')).toBeInTheDocument();
  });

  it('renders local storage only toggle', () => {
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.localStorageOnly')).toBeInTheDocument();
  });

  // QNBS-v3: dead crashReporting + shareUsageData toggles removed (no functional reads); 4 remain.
  it('renders four toggles total (analytics, encryption, localStorageOnly, euDataResidency)', () => {
    render(<PrivacySection />);
    expect(screen.getAllByRole('switch').length).toBe(4);
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

  // QNBS-v3: verify desktop users see the limitation instead of an implied encryption promise.
  it('warns desktop users that project files remain plaintext until R-15', () => {
    mockIsDesktop.value = true;
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionDesktopScope')).toBeInTheDocument();
  });

  // QNBS-v3: verify web-only IndexedDB encryption does not show a desktop filesystem warning.
  it('does not show the desktop-only storage scope warning on the web', () => {
    render(<PrivacySection />);
    expect(screen.queryByText('settings.privacy.encryptionDesktopScope')).not.toBeInTheDocument();
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

  it('dataEncryption toggle opens set modal when turned on', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);
    const toggle = screen.getByRole('switch', { name: 'settings.privacy.dataEncryption' });
    await user.click(toggle);
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('set');
  });

  it('keeps the encryption toggle checked and disabled while encryption is active', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    const toggle = screen.getByRole('switch', { name: 'settings.privacy.dataEncryption' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
  });

  it('shows active status, lock, change-passphrase, and disable actions when encryption is on and ready', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionActiveStatus')).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionLockAction')).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionChangeAction')).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionDisableAction')).toBeInTheDocument();
  });

  it('does not show change-passphrase or disable actions while locked', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: false,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.queryByText('settings.privacy.encryptionChangeAction')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.privacy.encryptionDisableAction')).not.toBeInTheDocument();
  });

  it('opens the rotate modal when Change Passphrase is clicked', async () => {
    const user = userEvent.setup();
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionChangeAction'));
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('rotate');
  });

  it('opens the disable modal when Disable is clicked', async () => {
    const user = userEvent.setup();
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionDisableAction'));
    expect(mockSetPassphraseModal).toHaveBeenCalledWith('disable');
  });

  it('shows locked status when encryption is on but key not in session', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: false,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionLockedStatus')).toBeInTheDocument();
  });

  it('shows lock session button when encryption is active', () => {
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    expect(screen.getByText('settings.privacy.encryptionLockAction')).toBeInTheDocument();
  });

  it('calls handleLockSession when lock session button is clicked', async () => {
    const user = userEvent.setup();
    const mockLock = vi.fn();
    mockCtx.mockReturnValue(
      makeCtx({
        featureFlags: { enableIdbAtRestEncryption: true },
        encryptionReady: true,
        handleLockSession: mockLock,
      }) as unknown as ReturnType<typeof useSettingsViewContext>,
    );
    render(<PrivacySection />);
    await user.click(screen.getByText('settings.privacy.encryptionLockAction'));
    expect(mockLock).toHaveBeenCalledTimes(1);
  });
});
