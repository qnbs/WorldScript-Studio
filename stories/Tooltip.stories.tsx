import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/ui/Button';
import { Tooltip } from '../components/ui/Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'UI/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <div className="flex justify-center p-16">
      <Tooltip label="Save document">
        <Button size="sm" variant="secondary">
          Hover me
        </Button>
      </Tooltip>
    </div>
  ),
};

export const WithShortcut: Story = {
  render: () => (
    <div className="flex justify-center p-16">
      <Tooltip label="Save" shortcut="Ctrl+S">
        <Button size="sm">Save</Button>
      </Tooltip>
    </div>
  ),
};

export const LongLabel: Story = {
  render: () => (
    <div className="flex justify-center p-16">
      <Tooltip label="Export manuscript as PDF document">
        <Button size="sm" variant="ghost">
          Export
        </Button>
      </Tooltip>
    </div>
  ),
};
