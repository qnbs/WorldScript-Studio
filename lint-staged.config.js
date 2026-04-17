export default {
  '*.{ts,tsx}': ['eslint --fix --no-warn-ignored --max-warnings 0'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
