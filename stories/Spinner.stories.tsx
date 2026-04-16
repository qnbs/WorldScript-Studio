import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from '../components/ui/Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  argTypes: {
    className: { control: 'text' },
    label: { control: 'text' },
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {
  args: {
    className: 'w-10 h-10',
    label: 'Loading…',
  },
};

export const Large: Story = {
  args: {
    className: 'w-16 h-16',
    label: 'Loading manuscript…',
  },
};
