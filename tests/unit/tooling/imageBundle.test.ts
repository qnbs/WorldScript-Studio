// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkBundleDompurify,
  dompurifyVersionsIn,
  MINIMUM_DOMPURIFY,
} from '../../../scripts/check-image-bundle.mjs';

const minified = (version: string) =>
  `var a=1;if(t.version=\`${version}\`,t.removed=[],!e||!e.document)return t;`;
const file = (text: string, name = 'assets/vendor.js') => ({ name, text });

describe('DOMPurify fingerprint in a web bundle (#1223)', () => {
  it('reads the version from the minified and the unminified build', () => {
    expect(dompurifyVersionsIn(minified('3.4.17'))).toEqual(['3.4.17']);
    expect(dompurifyVersionsIn('DOMPurify.version = "3.4.17";\n\tDOMPurify.removed = [];')).toEqual(
      ['3.4.17'],
    );
  });

  it('finds exactly the installed DOMPurify version in its shipped builds', () => {
    const { version } = JSON.parse(readFileSync('node_modules/dompurify/package.json', 'utf8')) as {
      version: string;
    };
    for (const build of ['purify.min.js', 'purify.es.mjs']) {
      const text = readFileSync(`node_modules/dompurify/dist/${build}`, 'utf8');
      expect(dompurifyVersionsIn(text), build).toEqual([version]);
    }
  });

  it('ignores a version assignment without the removed reset on the same object', () => {
    expect(dompurifyVersionsIn('x.version="9.9.9",x.other=[]')).toEqual([]);
    expect(dompurifyVersionsIn('a.version="9.9.9",b.removed=[]')).toEqual([]);
  });
});

describe('checkBundleDompurify', () => {
  it('passes a bundle with one DOMPurify build at or above the floor', () => {
    expect(
      checkBundleDompurify([file(minified(MINIMUM_DOMPURIFY)), file('noop()', 'assets/app.js')]),
    ).toEqual({ ok: true, versions: [MINIMUM_DOMPURIFY], files: ['assets/vendor.js'], errors: [] });
  });

  it.each([
    [
      'the DOMPurify build of the 1.29.2 image',
      [file(minified('3.4.16'))],
      'DOMPurify 3.4.16 is older than the required 3.4.17',
    ],
    ['a bundle without DOMPurify', [file('noop()')], 'no DOMPurify build found in the bundle'],
    [
      'two DOMPurify builds',
      [file(minified('3.4.17')), file(minified('3.5.0'), 'assets/other.js')],
      'more than one DOMPurify version in the bundle: 3.4.17, 3.5.0',
    ],
  ])('fails %s', (_name, files, error) => {
    const result = checkBundleDompurify(files);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(error);
  });

  it('accepts repeated copies of one fixed version (the requirement is one version, not one copy)', () => {
    const result = checkBundleDompurify([
      file(minified('3.4.17')),
      file(minified('3.4.17'), 'assets/other.js'),
    ]);

    expect(result).toEqual({
      ok: true,
      versions: ['3.4.17'],
      files: ['assets/other.js', 'assets/vendor.js'],
      errors: [],
    });
  });

  it('compares versions numerically', () => {
    expect(checkBundleDompurify([file(minified('3.4.100'))]).ok).toBe(true);
    expect(checkBundleDompurify([file(minified('3.4.9'))]).ok).toBe(false);
  });
});
