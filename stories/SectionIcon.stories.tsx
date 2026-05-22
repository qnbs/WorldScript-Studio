import type { Meta, StoryObj } from '@storybook/react';
import { SectionIcon } from '../components/ui/SectionIcon';
import type { View } from '../types';

const ALL_VIEWS: View[] = [
  'dashboard',
  'manuscript',
  'writer',
  'templates',
  'outline',
  'characters',
  'world',
  'export',
  'settings',
  'help',
  'sceneboard',
  'analytics',
  'zen',
  'characterGraph',
  'consistencyChecker',
  'critic',
  'mindmap',
  'characterInterviews',
  'objects',
  'preview',
  'progress',
];

const meta: Meta<typeof SectionIcon> = {
  title: 'UI/SectionIcon',
  component: SectionIcon,
  tags: ['autodocs'],
  argTypes: {
    section: { control: 'select', options: ALL_VIEWS },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
};
export default meta;
type Story = StoryObj<typeof SectionIcon>;

export const Default: Story = {
  args: { section: 'manuscript', size: 'md' },
};

export const AllSections: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3 p-4">
      {ALL_VIEWS.map((view) => (
        <div key={view} className="flex flex-col items-center gap-1">
          <SectionIcon section={view} size="md" />
          <span className="text-xs text-[var(--sc-text-muted)]">{view}</span>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4 p-4">
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-1">
          <SectionIcon section="characters" size={size} />
          <span className="text-xs text-[var(--sc-text-muted)]">{size}</span>
        </div>
      ))}
    </div>
  ),
};
