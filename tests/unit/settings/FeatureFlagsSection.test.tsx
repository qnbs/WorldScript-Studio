/**
 * Tests for components/settings/FeatureFlagsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests feature flag toggles list.
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

const mockFeatureFlags = {
  enableCodexAutoTracking: false,
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableCrossProjectSearch: false,
  enableAppHealthPanel: false,
  enablePlotBoardV2: false,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableCloudSync: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
  enableVoiceSupport: false,
  enableVoiceWasm: false,
  enableProForge: false,
  enableIdbAtRestEncryption: false,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    featureFlags: mockFeatureFlags,
    handleSettingChange: mockHandleSettingChange,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { FeatureFlagsSection } from '../../../components/settings/FeatureFlagsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the feature flags title', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.title')).toBeInTheDocument();
  });

  it('renders the feature flags description', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.description')).toBeInTheDocument();
  });

  it('renders all 19 feature flag toggles (enablePlotBoardV2 deprecated/hidden)', () => {
    render(<FeatureFlagsSection />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(19);
  });

  it('renders DuckDB analytics toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableDuckDbAnalytics')).toBeInTheDocument();
  });

  it('renders ProForge toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableProForge')).toBeInTheDocument();
  });

  it('renders voice support and voice WASM toggles', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableVoiceSupport')).toBeInTheDocument();
    expect(screen.getByText('settings.featureFlags.enableVoiceWasm')).toBeInTheDocument();
  });

  it('renders character interviews toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableCharacterInterviews')).toBeInTheDocument();
  });

  it('calls handleSettingChange when a flag is toggled', async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsSection />);
    const duckDbSwitch = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableDuckDbAnalytics',
    });
    await user.click(duckDbSwitch);
    expect(mockHandleSettingChange).toHaveBeenCalledWith('enableDuckDbAnalytics', true);
  });
});
