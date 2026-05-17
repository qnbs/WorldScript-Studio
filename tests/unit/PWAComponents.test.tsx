import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInstallApp = vi.fn();
const mockDismissInstall = vi.fn();
const mockApplyUpdate = vi.fn();
const mockDismissUpdate = vi.fn();

const mockUsePWA = vi.fn(() => ({
  isOffline: false,
  isInstallable: false,
  isUpdateAvailable: false,
  installApp: mockInstallApp,
  dismissInstall: mockDismissInstall,
  applyUpdate: mockApplyUpdate,
  dismissUpdate: mockDismissUpdate,
}));

vi.mock('../../hooks/usePWA', () => ({
  usePWA: () => mockUsePWA(),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import {
  OfflineIndicator,
  PWAInstallBanner,
  PWAUpdateToast,
} from '../../components/ui/PWAComponents';

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePWA.mockReturnValue({
    isOffline: false,
    isInstallable: false,
    isUpdateAvailable: false,
    installApp: mockInstallApp,
    dismissInstall: mockDismissInstall,
    applyUpdate: mockApplyUpdate,
    dismissUpdate: mockDismissUpdate,
  });
});

// ---------------------------------------------------------------------------
// OfflineIndicator
// ---------------------------------------------------------------------------

describe('OfflineIndicator', () => {
  it('renders nothing when online', () => {
    const { container } = render(<OfflineIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders badge when offline', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: true,
      isInstallable: false,
      isUpdateAvailable: false,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<OfflineIndicator />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('pwa.offlineBadgeTitle')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PWAInstallBanner
// ---------------------------------------------------------------------------

describe('PWAInstallBanner', () => {
  it('renders nothing when not installable', () => {
    const { container } = render(<PWAInstallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when installable', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: true,
      isUpdateAvailable: false,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAInstallBanner />);
    expect(screen.getByRole('banner')).toBeTruthy();
  });

  it('calls installApp when install button is clicked', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: true,
      isUpdateAvailable: false,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAInstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'pwa.install' }));
    expect(mockInstallApp).toHaveBeenCalledOnce();
  });

  it('calls dismissInstall when close button is clicked', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: true,
      isUpdateAvailable: false,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAInstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'pwa.closeBanner' }));
    expect(mockDismissInstall).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// PWAUpdateToast
// ---------------------------------------------------------------------------

describe('PWAUpdateToast', () => {
  it('renders nothing when no update available', () => {
    const { container } = render(<PWAUpdateToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders toast when update is available', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: false,
      isUpdateAvailable: true,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAUpdateToast />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('calls applyUpdate when update button is clicked', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: false,
      isUpdateAvailable: true,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAUpdateToast />);
    fireEvent.click(screen.getByRole('button', { name: 'pwa.updateNow' }));
    expect(mockApplyUpdate).toHaveBeenCalledOnce();
  });

  it('calls dismissUpdate when later button is clicked', () => {
    mockUsePWA.mockReturnValueOnce({
      isOffline: false,
      isInstallable: false,
      isUpdateAvailable: true,
      installApp: mockInstallApp,
      dismissInstall: mockDismissInstall,
      applyUpdate: mockApplyUpdate,
      dismissUpdate: mockDismissUpdate,
    });
    render(<PWAUpdateToast />);
    fireEvent.click(screen.getByRole('button', { name: 'pwa.later' }));
    expect(mockDismissUpdate).toHaveBeenCalledOnce();
  });
});
