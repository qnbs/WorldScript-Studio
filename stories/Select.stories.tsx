import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '../components/ui/Select';

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

const OPTIONS = [
  { value: '', label: 'Select an option' },
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

export const Default: Story = {
  args: {
    value: '',
    onChange: () => {},
    options: OPTIONS,
  },
};

export const WithValue: Story = {
  args: {
    value: 'b',
    onChange: () => {},
    options: [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B (selected)' },
      { value: 'c', label: 'Option C' },
    ],
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: 'a',
    onChange: () => {},
    options: [
      { value: 'a', label: 'Disabled Select' },
      { value: 'b', label: 'Option B' },
    ],
  },
};
