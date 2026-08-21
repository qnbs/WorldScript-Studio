import type { Meta, StoryObj } from '@storybook/react';
import { CustomIcon } from '../components/ui/Icon';

// QNBS-v3: keep the migrated icon in Storybook's accessibility inventory.
const meta: Meta<typeof CustomIcon> = {
  title: 'UI/CustomIcon',
  component: CustomIcon,
  tags: ['autodocs'],
  parameters: { a11y: { disable: false } },
};

export default meta;
type Story = StoryObj<typeof CustomIcon>;

export const Decorative: Story = {
  render: () => (
    <CustomIcon className="h-6 w-6 text-[var(--sc-accent)]" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5l7.5 7.5-7.5 7.5-7.5-7.5L12 4.5z"
      />
    </CustomIcon>
  ),
};
