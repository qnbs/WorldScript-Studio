import createDOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';

describe('DOMPurify security regressions', () => {
  it('removes SVG href animation targets in XHTML mode (GHSA-c6gr-qvv4-5v3f)', () => {
    const purifier = createDOMPurify(window);
    const clean = purifier.sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="safe;javascript:alert(1)" /></a></svg>',
      {
        PARSER_MEDIA_TYPE: 'application/xhtml+xml',
        ALLOWED_TAGS: ['svg', 'a', 'animate'],
        ALLOWED_ATTR: ['attributeName', 'values'],
      },
    );
    const output = new DOMParser().parseFromString(clean, 'application/xhtml+xml');
    const animation = output.querySelector('animate');

    expect(animation).not.toBeNull();
    expect(animation?.hasAttribute('attributeName')).toBe(false);
  });

  it('scrubs split template expressions inside attached shadow roots (GHSA-cg2g-xh64-v4q7)', () => {
    const purifier = createDOMPurify(window);
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const benign = document.createElement('span');
    benign.textContent = 'kept';
    shadow.append(
      benign,
      document.createTextNode('$'),
      document.createElement('object'),
      document.createTextNode('{unsafeExpression}'),
    );

    purifier.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });

    expect(shadow.querySelector('object')).toBeNull();
    expect(shadow.textContent).not.toContain(`\${unsafeExpression}`);
    expect(shadow.querySelector('span')?.textContent).toBe('kept');
  });

  it.each(['parent', 'nextSibling'] as const)(
    'neutralizes handlers in a %s detached by a hook (GHSA-mrv2-3pqr-j5jr)',
    (detachedNode) => {
      const purifier = createDOMPurify(window);
      const root = document.createElement('div');
      root.innerHTML =
        '<figure><img class="remove"><img id="unsafe" onerror="alert(1)"></figure><p>kept</p>';
      const unsafeImage = root.querySelector('#unsafe');
      expect(unsafeImage?.hasAttribute('onerror')).toBe(true);
      purifier.addHook('afterSanitizeAttributes', (node) => {
        if (node.getAttribute('class') !== 'remove') return;
        if (detachedNode === 'parent') node.parentElement?.remove();
        else node.nextElementSibling?.remove();
      });

      purifier.sanitize(root, { IN_PLACE: true });

      expect(unsafeImage?.hasAttribute('onerror')).toBe(false);
      expect(root.querySelector('p')?.textContent).toBe('kept');
    },
  );
});
