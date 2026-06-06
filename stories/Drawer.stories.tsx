import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Drawer } from '../components/ui/Drawer';
import { I18nContext } from '../contexts/I18nContext';

const meta: Meta<typeof Drawer> = {
  title: 'UI/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  argTypes: {
    position: {
      control: 'select',
      options: ['left', 'right'],
    },
  },
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
type Story = StoryObj<typeof Drawer>;

const defaultT = <T = string>(key: string): T =>
  (key === 'common.close' ? 'Close' : key) as unknown as T;

const I18nMockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nContext.Provider
    value={{
      language: 'en',
      setLanguage: () => {},
      t: defaultT,
      isReady: true,
      dir: 'ltr',
      getPluralCategory: () => 'other',
      formatNumber: (v) => v.toString(),
      formatRelativeTime: (v, u) => `${v} ${u}`,
      getCollator: () => new Intl.Collator('en'),
      formatList: (items) => items.join(', '),
      formatDisplayName: (v) => v,
    }}
  >
    {children}
  </I18nContext.Provider>
);

const DrawerExample: React.FC<{ position?: 'left' | 'right' }> = ({ position = 'left' }) => {
  const [open, setOpen] = useState(true);

  return (
    <I18nMockProvider>
      <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--sc-surface-base)]">
        <Button onClick={() => setOpen(true)}>Open Drawer</Button>
        <Drawer
          isOpen={open}
          onClose={() => setOpen(false)}
          title="StoryCraft Drawer"
          position={position}
        >
          <div className="p-4 space-y-4 text-[var(--sc-text-secondary)]">
            <p>
              This drawer renders accessible focus-trap behavior and supports left / right
              placement.
            </p>
            <Button onClick={() => setOpen(false)} variant="secondary">
              Close drawer
            </Button>
          </div>
        </Drawer>
      </div>
    </I18nMockProvider>
  );
};

export const Left: Story = {
  render: (args) => <DrawerExample {...args} />,
  args: { position: 'left' },
};

export const Right: Story = {
  render: (args) => <DrawerExample {...args} />,
  args: { position: 'right' },
};
