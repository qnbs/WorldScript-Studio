import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AccessibilitySection,
  CollaborationSection,
  PrivacySection,
} from '../../../components/settings/SystemSections';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const baseContextValue = {
  t: (k: string) => k,
  language: 'en',
  settings: {
    theme: 'dark',
    editorFont: 'serif',
    fontSize: 16,
    lineSpacing: 1.5,
    paragraphSpacing: 1.5,
    aiCreativity: 'Balanced',
    advancedAi: { provider: 'gemini' },
    accessibility: {
      liveRegionVerbosity: 'full',
      presetId: 'default',
      highContrast: false,
      reduceMotion: false,
      focusIndicators: true,
      screenReaderMode: false,
    },
    collaboration: { webrtcSignalingUrls: [] },
    privacy: { analyticsEnabled: false, crashReportsEnabled: false },
    performance: { hardwareAcceleration: true },
    featureFlags: {},
    appearancePreset: 'default',
    enableLanguageTool: false,
    languageToolUrl: '',
    keyboardShortcuts: [],
    themeCustomization: {
      primaryColor: '#6366f1',
      secondaryColor: '#a5b4fc',
      accentColor: '#4f46e5',
      backgroundColor: '#0f0f0f',
    },
  },
  featureFlags: { enableCompileWizard: false },
  project: {
    title: 'My Story',
    manuscript: [],
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
  },
  activeCategory: 'general',
  setActiveCategory: vi.fn(),
  modal: { state: 'closed', payload: {} },
  setModal: vi.fn(),
  importFileRef: { current: null },
  snapshots: [],
  snapshotName: '',
  setSnapshotName: vi.fn(),
  handleLanguageChange: vi.fn(),
  handleSettingChange: vi.fn(),
  handleExport: vi.fn(),
  handleImport: vi.fn(),
  handleResetProject: vi.fn(),
  handleCreateSnapshot: vi.fn(),
  handleRestoreSnapshot: vi.fn(),
  handleDeleteSnapshot: vi.fn(),
  projectSize: '2.3 KB',
  currentWordCount: 0,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: vi.fn(() => baseContextValue),
}));

vi.mock('../../../contexts/AppContext', () => ({
  AppContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    _currentValue: null,
    _currentValue2: null,
  },
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        collaboration: {
          webrtcSignalingUrls: ['wss://signaling.example.com'],
          realTimeCollaboration: false,
          publicSharing: false,
          commentSystem: false,
          versionHistory: false,
        },
      },
    }),
  ),
}));

vi.mock('../../../features/settings/accessibilitySchema', () => ({
  accessibilityPresetDefaults: vi.fn(() => ({
    liveRegionVerbosity: 'full',
    presetId: 'default',
  })),
  normalizeAccessibilitySettings: vi.fn((input: unknown) =>
    typeof input === 'object' && input
      ? { presetId: 'custom', ...input }
      : { presetId: 'custom', highContrast: false, reducedMotion: false },
  ),
}));

vi.mock('../../../services/collaborationService', () => ({
  DEFAULT_WEBRTC_SIGNALING_URLS: ['wss://signaling.example.com'],
  collaborationService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: false,
  },
}));

vi.mock('../../../services/languageToolClient', () => ({
  assertLanguageToolAllowed: vi.fn(),
  languageToolPing: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccessibilitySection', () => {
  it('renders without throwing', () => {
    expect(() => render(<AccessibilitySection />)).not.toThrow();
  });

  it('shows accessibility title', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.title')).toBeTruthy();
  });
});

describe('CollaborationSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<CollaborationSection />)).not.toThrow();
  });
});

describe('PrivacySection', () => {
  it('renders without throwing', () => {
    expect(() => render(<PrivacySection />)).not.toThrow();
  });
});
