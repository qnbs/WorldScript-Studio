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

export const Default: Story = {
  args: {
    children: (
      <>
        <option value="">Select an option</option>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
        <option value="c">Option C</option>
      </>
    ),
  },
};

export const WithValue: Story = {
  args: {
    defaultValue: 'b',
    children: (
      <>
        <option value="a">Option A</option>
        <option value="b">Option B (selected)</option>
        <option value="c">Option C</option>
      </>
    ),
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: 'a',
    children: (
      <>
        <option value="a">Disabled Select</option>
        <option value="b">Option B</option>
      </>
    ),
  },
};
