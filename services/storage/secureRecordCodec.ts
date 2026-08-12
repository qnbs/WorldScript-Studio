/**
 * Versioned structured-clone-safe codec for encrypted secondary-store payloads.
 * QNBS-v3: JSON.stringify destroys Blob bytes, so protected records use an explicit binary codec.
 */

const CODEC_VERSION = 1 as const;

type EncodedNode =
  | { k: 'null' }
  | { k: 'undef' }
  | { k: 'bool'; v: boolean }
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'date'; v: string }
  | { k: 'arr'; v: EncodedNode[] }
  | { k: 'obj'; v: Record<string, EncodedNode> }
  | { k: 'blob'; mime: string; bytes: number[] }
  | { k: 'u8'; v: number[] };

function encodeScalarNode(value: unknown): EncodedNode {
  if (value === null) return { k: 'null' };
  if (value === undefined) return { k: 'undef' };
  if (typeof value === 'boolean') return { k: 'bool', v: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Secure-record codec cannot encode a non-finite number');
    }
    return { k: 'num', v: value };
  }
  if (typeof value === 'string') return { k: 'str', v: value };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Secure-record codec cannot encode an invalid date');
    }
    return { k: 'date', v: value.toISOString() };
  }
  if (value instanceof Uint8Array) return { k: 'u8', v: Array.from(value) };
  throw new Error(`Secure-record codec cannot encode ${typeof value}`);
}

async function encodeValueNode(value: unknown): Promise<EncodedNode> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    return { k: 'blob', mime: value.type || 'application/octet-stream', bytes: Array.from(bytes) };
  }
  if (Array.isArray(value)) {
    return { k: 'arr', v: await Promise.all(value.map((item) => encodeValueNode(item))) };
  }
  if (value instanceof Date || value instanceof Uint8Array) return encodeScalarNode(value);
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Secure-record codec cannot encode a non-plain structured-clone object');
    }
    const encodedEntries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([key, child]) => [key, await encodeValueNode(child)] as const,
      ),
    );
    return { k: 'obj', v: Object.fromEntries(encodedEntries) };
  }
  return encodeScalarNode(value);
}

function decodeNode(node: EncodedNode): unknown {
  switch (node.k) {
    case 'null':
      return null;
    case 'undef':
      return undefined;
    case 'bool':
    case 'num':
    case 'str':
      return node.v;
    case 'date': {
      const value = new Date(node.v);
      if (Number.isNaN(value.getTime()))
        throw new Error('Secure-record codec contains an invalid date');
      return value;
    }
    case 'u8':
      return new Uint8Array(node.v);
    case 'arr':
      return node.v.map((child) => decodeNode(child));
    case 'obj':
      return Object.fromEntries(
        Object.entries(node.v).map(([key, child]) => [key, decodeNode(child)]),
      );
    case 'blob':
      return new Blob([new Uint8Array(node.bytes)], { type: node.mime });
    default:
      throw new Error('Unsupported secure-record codec node');
  }
}

/** Serialize a payload for AES-GCM encryption without losing Blob bytes. */
export async function encodeSecureRecordValue(value: unknown): Promise<Uint8Array> {
  const root = await encodeValueNode(value);
  return new TextEncoder().encode(JSON.stringify({ v: CODEC_VERSION, root }));
}

/** Deserialize bytes produced by encodeSecureRecordValue with strict format validation. */
export function decodeSecureRecordValue(bytes: Uint8Array): unknown {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { v?: unknown; root?: unknown };
  if (parsed.v !== CODEC_VERSION || !parsed.root || typeof parsed.root !== 'object') {
    throw new Error('Unsupported or malformed secure-record codec payload');
  }
  return decodeNode(parsed.root as EncodedNode);
}
