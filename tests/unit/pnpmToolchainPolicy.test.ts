// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isVersionAtLeast } from '../../scripts/pnpm-version-policy.mjs';

// QNBS-v3: Compare semantic version components left-to-right so a lower major cannot pass on a higher minor.
describe('pnpm version policy', () => {
  it.each([
    ['11.11.0', '11.11.0', true],
    ['11.12.0', '11.11.0', true],
    ['12.0.0', '11.11.0', true],
    ['11.10.9', '11.11.0', false],
    ['10.99.0', '11.0.0', false],
    ['11.22.0', '11.11.0', true],
  ])('%s >= %s is %s', (version, minimum, expected) => {
    expect(isVersionAtLeast(version, minimum)).toBe(expected);
  });

  it('rejects malformed versions instead of treating them as secure', () => {
    expect(isVersionAtLeast('11.22', '11.11.0')).toBe(false);
    expect(isVersionAtLeast('11.22.0-beta.1', '11.11.0')).toBe(false);
  });
});
