import type { DecoratorFunction, Preview } from '@storybook/react';
import React, { useEffect } from 'react';

const withTheme: DecoratorFunction = (Story, context) => {
  useEffect(() => {
    const theme = context.globals.theme ?? 'dark';
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${theme}-theme`);
    return () => {
      document.body.classList.remove('light-theme', 'dark-theme');
    };
  }, [context.globals.theme]);

  return (
    <div className="min-h-screen p-6 bg-[var(--background-primary)] text-[var(--foreground-primary)]">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for stories',
      defaultValue: 'dark',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Dark Theme' },
          { value: 'light', title: 'Light Theme' },
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
