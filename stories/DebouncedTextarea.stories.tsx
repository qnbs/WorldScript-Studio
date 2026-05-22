import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { DebouncedTextarea } from '../components/ui/DebouncedTextarea';
import { StorybookWrapper } from './storybookProviders';

const meta: Meta<typeof DebouncedTextarea> = {
  title: 'UI/DebouncedTextarea',
  component: DebouncedTextarea,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StorybookWrapper>
        <Story />
      </StorybookWrapper>
    ),
  ],
  argTypes: {
    debounceTimeout: { control: { type: 'number', min: 0, max: 2000, step: 100 } },
    disabled: { control: 'boolean' },
    rows: { control: { type: 'number', min: 1, max: 20 } },
  },
};
export default meta;
type Story = StoryObj<typeof DebouncedTextarea>;

const Controlled = (args: React.ComponentProps<typeof DebouncedTextarea>) => {
  const [value, setValue] = useState('');
  const [committed, setCommitted] = useState('');
  return (
    <div className="space-y-2">
      <DebouncedTextarea
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
  args: { placeholder: 'Type notes here…', debounceTimeout: 750, rows: 4 },
};

export const FastDebounce: Story = {
  render: (args) => <Controlled {...args} />,
  args: { placeholder: 'Fast (150 ms)', debounceTimeout: 150, rows: 3 },
};

export const Disabled: Story = {
  render: (args) => <Controlled {...args} />,
  args: { placeholder: 'Disabled', disabled: true, rows: 3 },
};
