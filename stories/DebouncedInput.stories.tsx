import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { DebouncedInput } from '../components/ui/DebouncedInput';

const meta: Meta<typeof DebouncedInput> = {
  title: 'UI/DebouncedInput',
  component: DebouncedInput,
  tags: ['autodocs'],
  argTypes: {
    debounceTimeout: { control: { type: 'number', min: 0, max: 2000, step: 100 } },
    disabled: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<typeof DebouncedInput>;

const Controlled = (args: React.ComponentProps<typeof DebouncedInput>) => {
  const [value, setValue] = useState('');
  const [committed, setCommitted] = useState('');
  return (
    <div className="space-y-2">
      <DebouncedInput
        {...args}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onDebouncedChange={setCommitted}
      />
      <p className="text-sm text-[var(--sc-text-muted)]">Committed: {committed || '(none)'}</p>
    </div>
  );
};

export const Default: Story = {
  render: (args) => <Controlled {...args} />,
  args: { placeholder: 'Type to debounce…', debounceTimeout: 750 },
};

export const FastDebounce: Story = {
  render: (args) => <Controlled {...args} />,
  args: { placeholder: 'Fast debounce (150 ms)', debounceTimeout: 150 },
};

export const Disabled: Story = {
  render: (args) => <Controlled {...args} />,
  args: { placeholder: 'Disabled input', disabled: true },
};
