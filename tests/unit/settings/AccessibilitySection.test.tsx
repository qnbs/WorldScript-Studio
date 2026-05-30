/**
 * Tests for components/settings/AccessibilitySection.tsx
 * QNBS-v3: Mocks SettingsViewContext + AppContext; tests preset buttons, toggles, verbosity.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange, mockHandleNavigate, settingsRef } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
  mockHandleNavigate: vi.fn(),
  settingsRef: { current: {} as Record<string, unknown> },
}));

const makeSettings = (overrides = {}) => ({
  accessibility: {
    presetId: 'custom' as const,
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
    liveRegionVerbosity: 'normal' as const,
    focusIndicator: 'default' as const,
    keyboardNavigation: false,
    ...overrides,
  },
  language: 'en',
  theme: 'dark',
  editorFont: 'serif',
  fontSize: 16,
  lineSpacing: 1.5,
  collaboration: { webrtcSignalingUrls: [] },
  advancedAi: { provider: 'gemini', ragMode: 'hybrid' },
  voice: { enabled: false },
});

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: { ...makeSettings(), ...settingsRef.current },
    handleSettingChange: mockHandleSettingChange,
    handleResetSettings: vi.fn(),
    handleExportSettings: vi.fn(),
    handleImportSettings: vi.fn(),
  }),
}));

vi.mock('../../../contexts/AppContext', () => ({
  AppContext: {
    _currentValue: { handleNavigate: mockHandleNavigate },
  },
}));

vi.mock('../../../features/settings/accessibilitySchema', () => ({
  accessibilityPresetDefaults: (id: string) => ({
    presetId: id,
    highContrast: id === 'lowVision',
    reducedMotion: id === 'motor',
    largeText: id === 'lowVision',
    screenReader: id === 'screenReader',
    liveRegionVerbosity: 'normal' as const,
    focusIndicator: 'enhanced' as const,
    keyboardNavigation: true,
  }),
  normalizeAccessibilitySettings: (input: unknown) => ({
    presetId: 'custom' as const,
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
    focusIndicators: true,
    colorBlindMode: 'none' as const,
    liveRegionVerbosity: 'normal' as const,
    comfortableTargets: false,
    ...(typeof input === 'object' && input ? input : {}),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { AccessibilitySection } from '../../../components/settings/AccessibilitySection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccessibilitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = {};
  });

  // QNBS-v3: regression — pre-v1.8 settings had no accessibility object; page must not crash.
  it('renders without crashing when accessibility is undefined', () => {
    settingsRef.current = { accessibility: undefined };
    expect(() => render(<AccessibilitySection />)).not.toThrow();
    expect(screen.getByText('settings.accessibility.title')).toBeInTheDocument();
  });

  it('renders the section heading', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.title')).toBeInTheDocument();
  });

  it('renders all 4 preset buttons', () => {
    render(<AccessibilitySection />);
    expect(
      screen.getByRole('button', {
        name: 'settings.accessibility.hub.preset.motor',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'settings.accessibility.hub.preset.lowVision',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'settings.accessibility.hub.preset.cognitive',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'settings.accessibility.hub.preset.screenReader',
      }),
    ).toBeInTheDocument();
  });

  it('calls handleSettingChange when a preset is applied', async () => {
    const user = userEvent.setup();
    render(<AccessibilitySection />);
    await user.click(
      screen.getByRole('button', { name: 'settings.accessibility.hub.preset.motor' }),
    );
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'accessibility',
      expect.objectContaining({ presetId: 'motor' }),
    );
  });

  it('renders the live region verbosity select', () => {
    render(<AccessibilitySection />);
    expect(
      screen.getByRole('combobox', { name: 'settings.accessibility.liveRegionVerbosity' }),
    ).toBeInTheDocument();
  });

  it('calls handleSettingChange when verbosity changes', async () => {
    const user = userEvent.setup();
    render(<AccessibilitySection />);
    const select = screen.getByRole('combobox', {
      name: 'settings.accessibility.liveRegionVerbosity',
    });
    await user.selectOptions(select, 'verbose');
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'accessibility',
      expect.objectContaining({ liveRegionVerbosity: 'verbose', presetId: 'custom' }),
    );
  });

  it('renders high contrast toggle', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.highContrast')).toBeInTheDocument();
  });

  it('renders reduced motion toggle', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.reducedMotion')).toBeInTheDocument();
  });

  it('renders the preview section', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.hub.preview.sampleButton')).toBeInTheDocument();
  });

  it('renders the help button', () => {
    render(<AccessibilitySection />);
    expect(screen.getByText('settings.accessibility.hub.helpButton')).toBeInTheDocument();
  });
});
