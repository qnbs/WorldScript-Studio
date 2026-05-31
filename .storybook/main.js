// QNBS-v3: CJS shim — .storybook/package.json sets type:commonjs so all .js files here are CJS.
// Storybook CLI picks up main.js before main.ts; must include framework so build doesn't error.
// Full viteFinal config (Tailwind, plugin filters) lives in main.ts — used by ts-aware runners.
module.exports = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
};
