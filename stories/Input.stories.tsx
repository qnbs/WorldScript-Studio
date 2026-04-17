import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '../components/ui/Input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'Eingabe...' },
};

export const WithValue: Story = {
  args: { value: 'Beispieltext', readOnly: true },
};

export const Disabled: Story = {
  args: { placeholder: 'Deaktiviert', disabled: true },
};

export const WithLabel: Story = {
  render: () => (
    <div>
      <label htmlFor="story-input" style={{ display: 'block', marginBottom: 4 }}>
        Titel
      </label>
      <Input id="story-input" placeholder="Roman-Titel eingeben..." />
    </div>
  ),
};
