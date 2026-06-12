import type { Meta, StoryObj } from '@storybook/react';
import { Icon } from '../components/ui/Icon';

const meta: Meta<typeof Icon> = {
  title: 'UI/Icon',
  component: Icon,
  tags: ['autodocs'],
  argTypes: {
    name: {
      control: 'select',
      options: [
        'close',
        'chevron-down',
        'chevron-up',
        'chevron-left',
        'chevron-right',
        'microphone',
        'microphone-solid',
        'check',
        'info',
        'success',
        'error',
        'warning',
        'trash',
        'plus',
        'search',
        'menu',
        'settings',
        'ellipsis-vertical',
        'ellipsis-horizontal',
      ],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl'],
    },
    title: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

export const Close: Story = {
  args: { name: 'close', size: 'md' },
};

export const ChevronDown: Story = {
  args: { name: 'chevron-down', size: 'md' },
};

export const Microphone: Story = {
  args: { name: 'microphone', size: 'md' },
};

export const Check: Story = {
  args: { name: 'check', size: 'md' },
};

export const Info: Story = {
  args: { name: 'info', size: 'md' },
};

export const Success: Story = {
  args: { name: 'success', size: 'md' },
};

export const ErrorIcon: Story = {
  args: { name: 'error', size: 'md' },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-[var(--sc-text-primary)]">
      <Icon name="check" size="sm" />
      <Icon name="check" size="md" />
      <Icon name="check" size="lg" />
      <Icon name="check" size="xl" />
    </div>
  ),
};

export const WithTitle: Story = {
  args: { name: 'info', size: 'lg', title: 'Information' },
};
