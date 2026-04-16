import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { I18nContext } from '../contexts/I18nContext';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['default', 'lg', 'xl'],
    },
  },
  parameters: {
    layout: 'fullscreen',
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

const defaultT = <T = string>(key: string): T =>
  (key === 'common.close' ? 'Close' : key) as unknown as T;

const I18nMockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nContext.Provider
    value={{
      language: 'en',
      setLanguage: () => {},
      t: defaultT,
    }}
  >
    {children}
  </I18nContext.Provider>
);

const ModalExample: React.FC<{ size: 'default' | 'lg' | 'xl' | undefined }> = ({ size }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <I18nMockProvider>
      <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--background-primary)]">
        <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="StoryCraft Modal"
          size={size}
        >
          <div className="space-y-4">
            <p className="text-[var(--foreground-secondary)]">
              This modal demonstrates accessible dialog focus trapping, keyboard escape handling,
              and layout variants.
            </p>
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              Close dialog
            </Button>
          </div>
        </Modal>
      </div>
    </I18nMockProvider>
  );
};

export const Default: Story = {
  render: (args) => <ModalExample size={args.size} />,
  args: { size: 'default' },
};

export const Large: Story = {
  render: (args) => <ModalExample size={args.size} />,
  args: { size: 'lg' },
};

export const ExtraLarge: Story = {
  render: (args) => <ModalExample size={args.size} />,
  args: { size: 'xl' },
};
