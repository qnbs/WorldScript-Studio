import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from '../components/ui/EmptyState';

const BookIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1}
    stroke="currentColor"
    className="w-12 h-12"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
    />
  </svg>
);

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const TitleOnly: Story = {
  args: { title: 'No characters yet' },
};

export const WithDescription: Story = {
  args: {
    title: 'No characters yet',
    description: 'Start building your cast by adding your first character.',
  },
};

export const WithIcon: Story = {
  args: {
    title: 'No chapters yet',
    description: 'Your manuscript is empty. Start writing to see chapters here.',
    icon: BookIcon,
  },
};

export const WithActions: Story = {
  args: {
    title: 'No worlds created',
    description: 'Build rich settings for your story.',
    icon: BookIcon,
    primaryAction: { label: 'Create World', onClick: () => {} },
    secondaryAction: { label: 'Import', onClick: () => {} },
  },
};

export const PrimaryActionOnly: Story = {
  args: {
    title: 'No scenes yet',
    primaryAction: { label: 'Add Scene', onClick: () => {} },
  },
};
