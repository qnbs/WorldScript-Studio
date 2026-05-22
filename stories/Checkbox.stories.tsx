import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from '../components/ui/Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Unchecked: Story = {
  args: { id: 'cb-unchecked', label: 'Enable feature', defaultChecked: false },
};

export const Checked: Story = {
  args: { id: 'cb-checked', label: 'Enable feature', defaultChecked: true },
};

export const NoLabel: Story = {
  args: { id: 'cb-nolabel', defaultChecked: true },
};

export const Disabled: Story = {
  args: { id: 'cb-disabled', label: 'Disabled option', disabled: true, defaultChecked: false },
};

export const DisabledChecked: Story = {
  args: {
    id: 'cb-disabled-checked',
    label: 'Disabled and checked',
    disabled: true,
    defaultChecked: true,
  },
};
