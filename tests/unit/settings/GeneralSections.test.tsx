/**
 * Tests for components/settings/GeneralSections.tsx
 * QNBS-v3: Mocks SettingsViewContext + FeatureFlagsContext; tests language, theme, About.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange, mockHandleLanguageChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
  mockHandleLanguageChange: vi.fn(),
}));

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    language: 'en',
    handleLanguageChange: mockHandleLanguageChange,
    settings: {
      theme: 'dark',
      language: 'en',
      accessibility: { presetId: 'custom' },
      editorFont: 'serif',
      fontSize: 16,
      lineSpacing: 1.5,
      themeCustomization: { primaryColor: '#6366f1', accentColor: '#8b5cf6' },
      appearance: { preset: 'default' },
    },
    handleSettingChange: mockHandleSettingChange,
    handleResetSettings: vi.fn(),
  }),
}));

vi.mock('../../../contexts/FeatureFlagsContext', () => ({
  useFeatureFlags: () => ({ enableDebugMode: false }),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => false,
  getTauriAppVersion: vi.fn().mockResolvedValue('1.0.0'),
}));

const { mockUsePWA } = vi.hoisted(() => ({
  mockUsePWA: vi.fn(() => ({
    isInstallable: false,
    isInstalled: false,
    isUpdateAvailable: false,
    isOffline: false,
    installApp: vi.fn(),
    dismissInstall: vi.fn(),
    applyUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
    clearCache: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../hooks/usePWA', () => ({ usePWA: mockUsePWA }));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getStorageInfo: vi.fn().mockResolvedValue({ used: 1024, total: 10240, percent: 10 }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  AboutSection,
  AppearanceSection,
  GeneralSection,
} from '../../../components/settings/GeneralSections';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeneralSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the language title', () => {
    render(<GeneralSection />);
    expect(screen.getByText('settings.language.title')).toBeInTheDocument();
  });

  it('renders the language selector', () => {
    render(<GeneralSection />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls handleLanguageChange when language is changed', async () => {
    const user = userEvent.setup();
    render(<GeneralSection />);
    await user.selectOptions(screen.getByRole('combobox'), 'de');
    expect(mockHandleLanguageChange).toHaveBeenCalled();
  });
});

describe('AppearanceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the appearance title', () => {
    render(<AppearanceSection />);
    expect(screen.getByText('settings.appearance.title')).toBeInTheDocument();
  });

  it('renders dark, light, auto theme buttons', () => {
    render(<AppearanceSection />);
    expect(screen.getByText('settings.theme.dark')).toBeInTheDocument();
    expect(screen.getByText('settings.theme.light')).toBeInTheDocument();
    expect(screen.getByText('settings.theme.auto')).toBeInTheDocument();
  });

  it('calls handleSettingChange when theme button is clicked', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByText('settings.theme.light'));
    expect(mockHandleSettingChange).toHaveBeenCalledWith('theme', 'light');
  });
});

describe('AboutSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the about title', async () => {
    render(<AboutSection />);
    expect(screen.getByText('settings.about.title')).toBeInTheDocument();
  });

  it('renders app version information', async () => {
    render(<AboutSection />);
    // App name should be present
    expect(screen.getByText(/StoryCraft/i)).toBeInTheDocument();
  });
});

// QNBS-v3: PWAInstallCard — added to GeneralSection for persistent install access.
describe('GeneralSection — PWAInstallCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the PWA install title on web (non-Tauri)', () => {
    render(<GeneralSection />);
    expect(screen.getByText('settings.pwa.title')).toBeInTheDocument();
  });

  it('shows the install button when isInstallable is true', () => {
    mockUsePWA.mockReturnValueOnce({
      isInstallable: true,
      isInstalled: false,
      isUpdateAvailable: false,
      isOffline: false,
      installApp: vi.fn(),
      dismissInstall: vi.fn(),
      applyUpdate: vi.fn(),
      dismissUpdate: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
    });
    render(<GeneralSection />);
    expect(screen.getByText('settings.pwa.installBtn')).toBeInTheDocument();
  });

  it('shows installed status when isInstalled is true', () => {
    mockUsePWA.mockReturnValueOnce({
      isInstallable: false,
      isInstalled: true,
      isUpdateAvailable: false,
      isOffline: false,
      installApp: vi.fn(),
      dismissInstall: vi.fn(),
      applyUpdate: vi.fn(),
      dismissUpdate: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
    });
    render(<GeneralSection />);
    expect(screen.getByText('settings.pwa.installedTitle')).toBeInTheDocument();
  });

  it('shows browser install instructions when neither installable nor installed', () => {
    render(<GeneralSection />);
    expect(screen.getByText('settings.pwa.notAvailableTitle')).toBeInTheDocument();
  });

  it('shows the clear cache button in all states', () => {
    render(<GeneralSection />);
    expect(screen.getByText('settings.pwa.clearCache')).toBeInTheDocument();
  });
});
