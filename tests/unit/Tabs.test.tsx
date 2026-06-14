/**
 * Tests for components/ui/Tabs.tsx (Tabs + TabPanel)
 * QNBS-v3: WAI-ARIA tabs atom — tablist/tab roles, aria-selected, onChange, disabled, variants, panel visibility.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from '../../components/ui/Tabs';

const TABS = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three', disabled: true },
];

describe('Tabs', () => {
  it('renders a tablist with a tab per entry', () => {
    render(<Tabs tabs={TABS} activeTab="one" onChange={vi.fn()} ariaLabel="Sections" />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active tab with aria-selected', () => {
    render(<Tabs tabs={TABS} activeTab="two" onChange={vi.fn()} ariaLabel="Sections" />);
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the tab id when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeTab="one" onChange={onChange} ariaLabel="Sections" />);
    await user.click(screen.getByRole('tab', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('does not fire onChange for a disabled tab', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeTab="one" onChange={onChange} ariaLabel="Sections" />);
    const disabled = screen.getByRole('tab', { name: 'Three' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies the pills variant class on tabs', () => {
    render(<Tabs tabs={TABS} activeTab="one" onChange={vi.fn()} ariaLabel="S" variant="pills" />);
    expect(screen.getByRole('tab', { name: 'One' }).className).toContain('rounded-full');
  });

  it('marks the active tab with data-state=active and inactive otherwise', () => {
    render(
      <Tabs tabs={TABS} activeTab="one" onChange={vi.fn()} ariaLabel="S" variant="underline" />,
    );
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('data-state', 'inactive');
  });
});

describe('TabPanel', () => {
  it('shows content and exposes the tabpanel role when active', () => {
    render(
      <TabPanel tabId="one" activeTab="one" groupId="grp">
        Panel One
      </TabPanel>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel).toHaveTextContent('Panel One');
    expect(panel).toHaveAttribute('aria-labelledby', 'grp-one');
    expect(panel).toHaveAttribute('id', 'grp-one-panel');
  });

  it('hides the panel when not the active tab', () => {
    render(
      <TabPanel tabId="one" activeTab="two" groupId="grp">
        Panel One
      </TabPanel>,
    );
    // A hidden tabpanel is removed from the a11y tree, so query the section directly.
    const section = screen.getByText('Panel One').closest('section');
    expect(section).toHaveAttribute('hidden');
    expect(section?.className).toContain('hidden');
  });
});
