import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '../components/ui/Badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['experimental', 'beta', 'new', 'neutral'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Experimental: Story = {
  args: { variant: 'experimental', children: 'Experimental' },
};

export const Beta: Story = {
  args: { variant: 'beta', children: 'Beta' },
};

export const New: Story = {
  args: { variant: 'new', children: 'New' },
};

export const CustomLabel: Story = {
  args: { variant: 'beta', children: 'Preview' },
};

export const Decorative: Story = {
  // srLabel="" → aria-hidden (use beside already-labelled content)
  args: { variant: 'experimental', children: 'Experimental', srLabel: '' },
};
