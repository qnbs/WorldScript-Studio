import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { StorybookWrapper } from './storybookProviders';

const meta: Meta<typeof Button> = {
  title: 'UI/Toast',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      config: {
        rules: [{ id: 'aria-allowed-role', enabled: true }],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

const ToastDemo: React.FC = () => {
  const toast = useToast();

  return (
    <div className="min-h-screen bg-[var(--background-primary)] p-8 text-[var(--foreground-primary)]">
      <div className="grid gap-3 max-w-xl">
        <Button onClick={() => toast.success('Success', 'Your draft has been saved.')}>
          Success Toast
        </Button>
        <Button onClick={() => toast.error('Error', 'Unable to save your draft.')}>
          Error Toast
        </Button>
        <Button onClick={() => toast.info('Info', 'Autosave will run in 5 seconds.')}>
          Info Toast
        </Button>
      </div>
    </div>
  );
};

export const Default: Story = {
  render: () => (
    <StorybookWrapper>
      <ToastDemo />
    </StorybookWrapper>
  ),
};
