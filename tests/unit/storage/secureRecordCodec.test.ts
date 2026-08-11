// @vitest-environment node
// QNBS-v3: The codec must preserve structured-clone data rather than silently changing encrypted content.
import { describe, expect, it } from 'vitest';
import {
  decodeSecureRecordValue,
  encodeSecureRecordValue,
} from '../../../services/storage/secureRecordCodec';

describe('secureRecordCodec', () => {
  it('round-trips Blob bytes, Uint8Array, and explicit undefined values', async () => {
    const original = {
      absent: undefined,
      bytes: new Uint8Array([7, 8, 9]),
      artifact: new Blob(['screenplay'], { type: 'text/plain' }),
      nested: [undefined, { value: undefined }],
    };

    const decoded = decodeSecureRecordValue(await encodeSecureRecordValue(original)) as {
      absent: undefined;
      bytes: Uint8Array;
      artifact: Blob;
      nested: [undefined, { value: undefined }];
    };

    expect('absent' in decoded).toBe(true);
    expect(decoded.absent).toBeUndefined();
    expect(decoded.bytes).toEqual(new Uint8Array([7, 8, 9]));
    expect(decoded.artifact).toBeInstanceOf(Blob);
    await expect(decoded.artifact.text()).resolves.toBe('screenplay');
    expect(decoded.nested[0]).toBeUndefined();
    expect('value' in decoded.nested[1]).toBe(true);
    expect(decoded.nested[1].value).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1n, () => undefined, Symbol('secret')])(
    'rejects a value the codec cannot represent safely',
    async (value) => {
      await expect(encodeSecureRecordValue(value)).rejects.toThrow('cannot encode');
    },
  );

  it('rejects malformed and unsupported serialized payloads', () => {
    expect(() => decodeSecureRecordValue(new TextEncoder().encode('{"v":2,"root":{}}'))).toThrow(
      'Unsupported or malformed',
    );
    expect(() => decodeSecureRecordValue(new TextEncoder().encode('{"v":1}'))).toThrow(
      'Unsupported or malformed',
    );
    expect(() => decodeSecureRecordValue(new TextEncoder().encode('{"v":1,"root":{}}'))).toThrow(
      'Unsupported secure-record codec node',
    );
  });
});
