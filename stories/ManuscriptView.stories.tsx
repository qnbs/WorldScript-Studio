import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { Provider } from 'react-redux';
import { setupStore } from '../app/store';
import { ManuscriptView } from '../components/ManuscriptView';
import { ToastProvider } from '../components/ui/Toast';
import { I18nContext } from '../contexts/I18nContext';
import { projectActions } from '../features/project/projectSlice';

const store = setupStore();
store.dispatch(
  projectActions.setManuscript([
    {
      id: 'section-1',
      title: 'Act I: The Arrival',
      content:
        'A distant land sits quiet beneath the early morning mist. Our protagonist steps onto the shore, uncertain and hopeful.',
    },
    {
      id: 'section-2',
      title: 'Act II: The Conflict',
      content:
        'The village is shaken by unexpected news. Allies are tested and the true stakes begin to emerge in every paragraph.',
    },
    {
      id: 'section-3',
      title: 'Act III: Resolution',
      content:
        'A final confrontation forces the hero to choose between saving the world and saving themselves.',
    },
  ]),
);

const defaultT = <T = string>(key: string): T => key as unknown as T;

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

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Provider store={store}>
    <I18nMockProvider>
      <ToastProvider>{children}</ToastProvider>
    </I18nMockProvider>
  </Provider>
);

const meta: Meta<typeof ManuscriptView> = {
  title: 'Views/ManuscriptView',
  component: ManuscriptView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      config: {
        rules: [{ id: 'landmark-one-main', enabled: true }],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ManuscriptView>;

export const Default: Story = {
  render: () => (
    <Wrapper>
      <div className="min-h-screen bg-[var(--background-primary)] text-[var(--foreground-primary)]">
        <ManuscriptView />
      </div>
    </Wrapper>
  ),
};
