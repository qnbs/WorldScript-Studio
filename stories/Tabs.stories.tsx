import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { useState } from 'react';
import { TabPanel, Tabs } from '../components/ui/Tabs';

const TABS = [
  { id: 'outline', label: 'Outline' },
  { id: 'manuscript', label: 'Manuscript' },
  { id: 'notes', label: 'Notes', disabled: true },
];

const meta: Meta<typeof Tabs> = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'pills', 'underline'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const TabsDemo: React.FC<{ variant?: 'default' | 'pills' | 'underline' }> = ({
  variant = 'default',
}) => {
  const [activeTab, setActiveTab] = useState('outline');
  return (
    <div className="space-y-4">
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel="Document sections"
        variant={variant}
      />
      <div className="p-4 rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-secondary)]">
        Active tab: <span className="text-[var(--sc-text-primary)] font-medium">{activeTab}</span>
      </div>
    </div>
  );
};

export const Default: Story = {
  render: () => <TabsDemo variant="default" />,
};

export const Pills: Story = {
  render: () => <TabsDemo variant="pills" />,
};

export const Underline: Story = {
  render: () => <TabsDemo variant="underline" />,
};

// QNBS-v3: hooks belong in a component, not a story render callback (DeepSource JS-0820 /
// rules-of-hooks). Storybook renders this as a component, so useState is valid here.
const WithPanelsDemo = () => {
  const [activeTab, setActiveTab] = useState('outline');
  const groupId = 'story-tabs';
  return (
    <div className="space-y-4">
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel="Document sections"
      />
      <TabPanel tabId="outline" activeTab={activeTab} groupId={groupId}>
        <div className="p-4 rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]">
          Outline content
        </div>
      </TabPanel>
      <TabPanel tabId="manuscript" activeTab={activeTab} groupId={groupId}>
        <div className="p-4 rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]">
          Manuscript content
        </div>
      </TabPanel>
      <TabPanel tabId="notes" activeTab={activeTab} groupId={groupId}>
        <div className="p-4 rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]">
          Notes content
        </div>
      </TabPanel>
    </div>
  );
};

export const WithPanels: Story = {
  render: () => <WithPanelsDemo />,
};
