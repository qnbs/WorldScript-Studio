import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

const meta: Meta<typeof ErrorBoundary> = {
  title: 'UI/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      config: {
        rules: [{ id: 'aria-allowed-attr', enabled: true }],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

const BuggyChild: React.FC = () => {
  throw new Error('Storybook error boundary test');
};

const ErrorBoundaryExample: React.FC = () => {
  const [crash, setCrash] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--background-primary)] p-8 text-[var(--foreground-primary)]">
      <ErrorBoundary onReset={() => setCrash(false)}>
        {crash ? <BuggyChild /> : <Button onClick={() => setCrash(true)}>Trigger error</Button>}
      </ErrorBoundary>
    </div>
  );
};

export const Default: Story = {
  render: () => <ErrorBoundaryExample />,
};
