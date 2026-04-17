import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  viteFinal: async (config) => {
    // Add Tailwind CSS v4 Vite plugin
    config.plugins = config.plugins ?? [];
    config.plugins.push(tailwindcss());
    // Remove VitePWA plugin (incompatible with Storybook builds)
    config.plugins = config.plugins.flat().filter(
      (p) => p && typeof p === 'object' && 'name' in p && p.name !== 'vite-plugin-pwa' && p.name !== 'vite-plugin-pwa:build' && p.name !== 'vite-plugin-pwa:info' && p.name !== 'vite-plugin-pwa:main' && p.name !== 'vite-plugin-pwa:dev-sw',
    );
    return config;
  },
};

export default config;
