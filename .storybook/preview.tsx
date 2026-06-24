import type { DecoratorFunction, Preview } from '@storybook/react';
import React, { useEffect } from 'react';
import '../index.css';

const APPEARANCE_CLASSES = ['appearance-sepia', 'appearance-fantasy', 'appearance-romance'];

// QNBS-v3: the theme effect lives in a component, not the decorator callback (DeepSource JS-0820 /
// rules-of-hooks). Storybook renders ThemeWrapper as a component, so useEffect is valid here.
const ThemeWrapper = ({
  theme,
  appearance,
  children,
}: {
  theme: string;
  appearance: string;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${theme}-theme`);

    document.body.classList.remove(...APPEARANCE_CLASSES);
    if (appearance === 'sepia') document.body.classList.add('appearance-sepia');
    if (appearance === 'fantasy') document.body.classList.add('appearance-fantasy');
    if (appearance === 'romance') document.body.classList.add('appearance-romance');

    return () => {
      document.body.classList.remove('light-theme', 'dark-theme', ...APPEARANCE_CLASSES);
    };
  }, [theme, appearance]);

  return (
    <div className="min-h-screen p-6 bg-sc-surface-base text-sc-text-primary">{children}</div>
  );
};

const withTheme: DecoratorFunction = (Story, context) => (
  <ThemeWrapper
    theme={context.globals.theme ?? 'dark'}
    appearance={context.globals.appearance ?? 'default'}
  >
    <Story />
  </ThemeWrapper>
);

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Light/dark shell',
      defaultValue: 'dark',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
      },
    },
    appearance: {
      name: 'Appearance',
      description: 'Creative palette preset',
      defaultValue: 'default',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Default' },
          { value: 'sepia', title: "Writer's Sepia" },
          { value: 'fantasy', title: 'Fantasy accent' },
          { value: 'romance', title: 'Romance accent' },
        ],
      },
    },
  },
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#020617' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
};

export default preview;
