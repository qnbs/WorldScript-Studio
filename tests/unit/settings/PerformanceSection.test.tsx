/**
 * Tests for components/settings/PerformanceSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests auto-save slider, cache size, toggles.
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
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    settings: {
      performance: {
        autoSaveInterval: 30,
        cacheSize: 100,
        preloadContent: true,
        lazyLoadImages: false,
        offlineMode: false,
      },
    },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PerformanceSection } from '../../../components/settings/PerformanceSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerformanceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the performance title', () => {
    render(<PerformanceSection />);
    expect(screen.getByText('settings.performance.title')).toBeInTheDocument();
  });

  it('renders the auto-save interval label', () => {
    render(<PerformanceSection />);
    expect(screen.getByText(/settings.performance.autoSaveInterval/)).toBeInTheDocument();
  });

  it('renders the cache size label', () => {
    render(<PerformanceSection />);
    expect(screen.getByText(/settings.performance.cacheSize/)).toBeInTheDocument();
  });

  it('renders preload content toggle', () => {
    render(<PerformanceSection />);
    expect(screen.getByText('settings.performance.preloadContent')).toBeInTheDocument();
  });

  it('renders lazy load images toggle', () => {
    render(<PerformanceSection />);
    expect(screen.getByText('settings.performance.lazyLoadImages')).toBeInTheDocument();
  });

  it('renders offline mode toggle', () => {
    render(<PerformanceSection />);
    expect(screen.getByText('settings.performance.offlineMode')).toBeInTheDocument();
  });

  it('calls handleSettingChange when preload content is toggled', async () => {
    const user = userEvent.setup();
    render(<PerformanceSection />);
    await user.click(screen.getByRole('switch', { name: 'settings.performance.preloadContent' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'performance',
      expect.objectContaining({ preloadContent: false }),
    );
  });

  it('renders two sliders for auto-save and cache size', () => {
    render(<PerformanceSection />);
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThanOrEqual(2);
  });
});
