import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { I18nMockProvider } from './storybookProviders';

const meta: Meta<typeof BottomSheet> = {
  title: 'UI/BottomSheet',
  component: BottomSheet,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <I18nMockProvider>
        <Story />
      </I18nMockProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BottomSheet>;

function BottomSheetDemo({ height }: { height: 'half' | 'full' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open BottomSheet</Button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Sheet Title" height={height}>
        <p className="text-sm text-[var(--sc-text-secondary)]">
          This is the sheet content. Drag down or press Escape to dismiss.
        </p>
      </BottomSheet>
    </>
  );
}

export const Half: Story = {
  render: () => <BottomSheetDemo height="half" />,
};

export const Full: Story = {
  render: () => <BottomSheetDemo height="full" />,
};
