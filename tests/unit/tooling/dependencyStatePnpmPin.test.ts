import { describe, expect, it } from 'vitest';
import { pnpmPinMismatch } from '../../../scripts/dependency-state.mjs';

describe('pnpmPinMismatch', () => {
  it('accepts the exact pinned version', () => {
    expect(pnpmPinMismatch('pnpm@12.13.0', '12.13.0')).toBeNull();
  });

  it('rejects a different host pnpm', () => {
    expect(pnpmPinMismatch('pnpm@12.13.0', '12.2.1')).toBe(
      'pnpm 12.13.0 is required by packageManager; found 12.2.1.',
    );
  });

  it('rejects a missing pnpm', () => {
    expect(pnpmPinMismatch('pnpm@12.13.0', '')).toBe(
      'pnpm 12.13.0 is required by packageManager; found no pnpm.',
    );
  });

  it.each([undefined, 'pnpm@12', 'pnpm@^12.13.0', 'yarn@4.18.0'])(
    'requires an exact pnpm pin (%s)',
    (packageManager) => {
      expect(pnpmPinMismatch(packageManager, '12.13.0')).toBe(
        'package.json must pin packageManager to pnpm@<exact-version>.',
      );
    },
  );
});
