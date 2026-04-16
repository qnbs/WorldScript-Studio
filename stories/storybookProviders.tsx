import type { ReactNode } from 'react';
import React from 'react';
import { Provider } from 'react-redux';
import { setupStore } from '../app/store';
import { I18nContext } from '../contexts/I18nContext';
import { ToastProvider } from '../components/ui/Toast';

const defaultTranslations: Record<string, string> = {
  'common.close': 'Close',
  'manuscript.navigator.title': 'Navigator',
  'manuscript.inspector.title': 'Inspector',
  'manuscript.untitledSection': 'Untitled Section',
};

const defaultT = <T = string>(key: string): T =>
  (defaultTranslations[key] ?? key) as unknown as T;

const store = setupStore();

export const StorybookWrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
  <Provider store={store}>
    <I18nContext.Provider
      value={{
        language: 'en',
        setLanguage: () => {},
        t: (key: string) => defaultT(key),
      }}
    >
      <ToastProvider>{children}</ToastProvider>
    </I18nContext.Provider>
  </Provider>
);

export const I18nMockProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <I18nContext.Provider
    value={{
      language: 'en',
      setLanguage: () => {},
      t: (key: string) => defaultT(key),
    }}
  >
    {children}
  </I18nContext.Provider>
);
