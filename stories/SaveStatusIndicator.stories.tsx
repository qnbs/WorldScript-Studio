import type { Meta, StoryObj } from '@storybook/react';
import { Provider } from 'react-redux';
import { setupStore } from '../app/store';
import { SaveStatusIndicator } from '../components/ui/SaveStatusIndicator';
import { I18nMockProvider } from './storybookProviders';

const meta: Meta<typeof SaveStatusIndicator> = {
  title: 'UI/SaveStatusIndicator',
  component: SaveStatusIndicator,
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
type Story = StoryObj<typeof SaveStatusIndicator>;

function makeStore(saving: 'idle' | 'saving' | 'saved') {
  const store = setupStore();
  // Dispatch a state patch via the status slice action
  store.dispatch({ type: 'status/setSavingStatus', payload: saving });
  return store;
}

export const Idle: Story = {
  decorators: [
    (Story) => (
      <Provider store={makeStore('idle')}>
        <Story />
      </Provider>
    ),
  ],
  render: () => (
    <div className="p-4">
      <SaveStatusIndicator />
      <p className="text-xs text-[var(--sc-text-muted)] mt-2">(idle — renders nothing)</p>
    </div>
  ),
};

export const Saving: Story = {
  decorators: [
    (Story) => (
      <Provider store={makeStore('saving')}>
        <Story />
      </Provider>
    ),
  ],
  render: () => <SaveStatusIndicator />,
};

export const Saved: Story = {
  decorators: [
    (Story) => (
      <Provider store={makeStore('saved')}>
        <Story />
      </Provider>
    ),
  ],
  render: () => <SaveStatusIndicator />,
};
