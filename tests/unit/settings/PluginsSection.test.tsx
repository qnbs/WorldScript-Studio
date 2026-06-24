/**
 * Tests for components/settings/PluginsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + pluginRegistry; tests flag gate, plugin list, empty state.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsEnabled = false;
const mockPluginList = vi.fn().mockReturnValue([]);

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn(() => mockIsEnabled),
}));

// QNBS-v3: featureFlagsSlice is NOT mocked — useAppSelector above is mocked to ignore its selector
// argument (returns mockIsEnabled), so the real, typed selectEnablePluginSystem is harmlessly unused,
// and featureCatalog (loaded via the section's MaturityBadge) keeps its real defaultFeatureFlagsState.

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('../../../services/pluginRegistry', () => ({
  pluginRegistry: {
    list: (...args: unknown[]) => mockPluginList(...args),
    unregister: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PluginsSection } from '../../../components/settings/PluginsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled = false;
    mockPluginList.mockReturnValue([]);
  });

  it('shows flag gate when plugin system is disabled', () => {
    render(<PluginsSection />);
    expect(screen.getByText('settings.plugins.title')).toBeInTheDocument();
    expect(screen.getByText('settings.plugins.flagGate')).toBeInTheDocument();
  });

  // QNBS-v3: maturity signalling must stay consistent whether the flag is on or off.
  it('shows the Beta maturity badge even when the plugin system is disabled', () => {
    render(<PluginsSection />);
    expect(screen.getByText('common.badge.beta')).toBeInTheDocument();
  });

  it('shows empty state when feature enabled but no plugins', () => {
    mockIsEnabled = true;
    render(<PluginsSection />);
    expect(screen.getByText('settings.plugins.title')).toBeInTheDocument();
    // QNBS-v3: key is 'emptyState' not 'empty'
    expect(screen.getByText('settings.plugins.emptyState')).toBeInTheDocument();
  });

  it('renders plugin list when plugins are available', () => {
    mockIsEnabled = true;
    mockPluginList.mockReturnValue([
      {
        id: 'plugin-1',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        type: 'command',
        author: 'Tester',
        permissions: [],
      },
    ]);
    render(<PluginsSection />);
    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('shows plugin version when plugins are listed', () => {
    mockIsEnabled = true;
    mockPluginList.mockReturnValue([
      {
        id: 'plugin-2',
        name: 'Another Plugin',
        version: '2.1.3',
        description: 'Another test plugin',
        type: 'ai-tool',
        author: 'Dev',
        permissions: [],
      },
    ]);
    render(<PluginsSection />);
    expect(screen.getByText(/2\.1\.3/)).toBeInTheDocument();
  });

  it('shows plugin type badge for each plugin', () => {
    mockIsEnabled = true;
    mockPluginList.mockReturnValue([
      {
        id: 'plugin-3',
        name: 'Command Plugin',
        version: '0.9.0',
        description: '',
        type: 'command',
        author: 'Dev',
        permissions: [],
      },
    ]);
    render(<PluginsSection />);
    expect(screen.getByText('command')).toBeInTheDocument();
  });
});
