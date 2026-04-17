import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/ui/Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: 'primary', children: 'Speichern' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Abbrechen' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Löschen' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Mehr' },
};

export const Small: Story = {
  args: { size: 'sm', children: 'Klein' },
};

export const Large: Story = {
  args: { size: 'lg', children: 'Groß' },
};

export const Disabled: Story = {
  args: { disabled: true, children: 'Deaktiviert' },
};
