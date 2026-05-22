import type { Meta, StoryObj } from '@storybook/react';
import { AddNewCard } from '../components/ui/AddNewCard';

const AddIcon = <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />;

const SparklesIcon = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
  />
);

const meta: Meta<typeof AddNewCard> = {
  title: 'UI/AddNewCard',
  component: AddNewCard,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'primary'] },
  },
};

export default meta;
type Story = StoryObj<typeof AddNewCard>;

export const Default: Story = {
  args: {
    variant: 'default',
    title: 'Add Manually',
    description: 'Create a new entry from scratch',
    icon: AddIcon,
    onClick: () => {},
  },
};

export const Primary: Story = {
  args: {
    variant: 'primary',
    title: 'Create with AI',
    description: 'Let AI generate a character for you',
    icon: SparklesIcon,
    onClick: () => {},
  },
};
