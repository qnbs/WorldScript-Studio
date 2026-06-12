import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { useState } from 'react';
import { RadioGroup } from '../components/ui/RadioGroup';

const OPTIONS = [
  { value: 'draft', label: 'Draft', description: 'Only visible to you' },
  { value: 'review', label: 'Review', description: 'Share with beta readers' },
  { value: 'published', label: 'Published' },
];

const meta: Meta<typeof RadioGroup> = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: 'select',
      options: ['vertical', 'horizontal'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

const RadioGroupDemo: React.FC<{ orientation?: 'vertical' | 'horizontal' }> = ({
  orientation = 'vertical',
}) => {
  const [value, setValue] = useState('draft');
  return (
    <RadioGroup
      name="status"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      orientation={orientation}
    />
  );
};

export const Vertical: Story = {
  render: () => <RadioGroupDemo orientation="vertical" />,
};

export const Horizontal: Story = {
  render: () => <RadioGroupDemo orientation="horizontal" />,
};

export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup
      name="plan"
      options={[
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro', disabled: true },
        { value: 'team', label: 'Team' },
      ]}
      value="free"
      onChange={() => {}}
    />
  ),
};
