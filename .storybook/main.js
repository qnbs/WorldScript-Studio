// QNBS-v3: CJS shim — two roles:
// 1. @storybook/test-runner reads this via serverRequire() to discover stories
// 2. Storybook CLI reads this before main.ts — must have framework to avoid MissingBuilderError
// Two separate glob entries for maximum glob-library compatibility.
module.exports = {
  stories: ['../stories/**/*.stories.tsx', '../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
};
