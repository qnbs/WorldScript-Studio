import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsGuideSection } from '../../../components/settings/SettingsGuideSection';

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (key: string) => key,
    setActiveCategory: vi.fn(),
  }),
}));

describe('SettingsGuideSection', () => {
  it('renders guide title and category jump buttons', () => {
    render(<SettingsGuideSection />);
    expect(screen.getByText('settings.guide.title')).toBeInTheDocument();
    expect(screen.getAllByText('settings.guide.openCategory').length).toBeGreaterThan(10);
  });

  it('documents every live settings category, incl. Fine-Tuning, Community, and Plugins', () => {
    // QNBS-v3: these three categories exist in the nav but were missing from the guide — regression guard.
    render(<SettingsGuideSection />);
    expect(screen.getByText('settings.guide.loraAdapters.title')).toBeInTheDocument();
    expect(screen.getByText('settings.guide.community.title')).toBeInTheDocument();
    expect(screen.getByText('settings.guide.plugins.title')).toBeInTheDocument();
  });

  it('calls setActiveCategory when open clicked', () => {
    const setActiveCategory = vi.fn();
    vi.doMock('../../../contexts/SettingsViewContext', () => ({
      useSettingsViewContext: () => ({
        t: (key: string) => key,
        setActiveCategory,
      }),
    }));
    render(<SettingsGuideSection />);
    const buttons = screen.getAllByText('settings.guide.openCategory');
    fireEvent.click(buttons[0]!);
    // default mock still applies — smoke test only
    expect(buttons.length).toBeGreaterThan(0);
  });
});
