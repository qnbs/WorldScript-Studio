// QNBS-v3: CJS shim for @storybook/test-runner (v0.21) which reads main.js via serverRequire
// and doesn't resolve the ESM default export from main.ts. The full build config lives in main.ts.
// This file only provides the `stories` glob so the test-runner can discover story files.
module.exports = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
};
