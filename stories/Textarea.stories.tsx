import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from '../components/ui/Textarea';
import { StorybookWrapper } from './storybookProviders';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StorybookWrapper>
        <Story />
      </StorybookWrapper>
    ),
  ],
  argTypes: {
    disabled: { control: 'boolean' },
    rows: { control: { type: 'number', min: 1, max: 20 } },
  },
};
export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Write your story…', rows: 5 },
};

export const WithContent: Story = {
  args: {
    defaultValue:
      'The castle loomed against the purple twilight, its towers stretching toward the first stars.',
    rows: 5,
  },
};

export const Disabled: Story = {
  args: { defaultValue: 'Read-only content', disabled: true, rows: 3 },
};

export const Tall: Story = {
  args: { placeholder: 'Long-form entry…', rows: 12 },
};
