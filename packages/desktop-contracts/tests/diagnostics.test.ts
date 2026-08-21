import { describe, expect, it } from 'vitest';
import { sanitizeDiagnosticsContext, sanitizeDiagnosticsValue } from '../src/diagnostics';

describe('renderer-neutral diagnostics sanitization', () => {
  // QNBS-v3: hostile object behavior must fail closed without escaping the diagnostics boundary.
  it('returns safe markers for throwing getters, enumeration, array mapping, and prototypes', () => {
    const throwingGetter = {} as Record<string, unknown>;
    let getterReads = 0;
    Object.defineProperty(throwingGetter, 'value', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        if (getterReads > 1) throw new Error('getter failed');
        return 'visible during enumeration';
      },
    });

    const throwingEnumeration = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('enumeration failed');
        },
      },
    ) as Record<string, unknown>;

    const throwingArray = new Proxy([1], {
      get(target, property, receiver) {
        if (property === 'map') throw new Error('array mapping failed');
        return Reflect.get(target, property, receiver);
      },
    });

    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('prototype lookup failed');
        },
      },
    );

    expect(sanitizeDiagnosticsContext(throwingGetter)).toEqual({ value: '[Unserializable]' });
    expect(sanitizeDiagnosticsContext(throwingEnumeration)).toEqual({
      '[Unserializable]': '[Unserializable]',
    });
    expect(sanitizeDiagnosticsValue(throwingArray)).toBe('[Unserializable]');
    expect(sanitizeDiagnosticsValue(throwingPrototype)).toBe('[Unserializable]');
  });

  it('marks circular arrays without recursing forever', () => {
    const circular: unknown[] = [];
    circular.push(circular);

    expect(sanitizeDiagnosticsValue(circular)).toEqual(['[CIRCULAR]']);
  });
});
