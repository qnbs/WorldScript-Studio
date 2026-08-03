/**
 * Versioned structured-clone-safe codec for secondary-store encryption payloads.
 * QNBS-v3: JSON.stringify destroys Blob/File bytes — this codec preserves binary artifacts for ProForge history.
 */

const CODEC_VERSION = 1 as const;

type EncodedNode =
  | { k: 'null' }
  | { k: 'bool'; v: boolean }
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'date'; v: string }
  | { k: 'arr'; v: EncodedNode[] }
  | { k: 'obj'; v: Record<string, EncodedNode> }
  | { k: 'blob'; mime: string; bytes: number[] }
  | { k: 'u8'; v: number[] };

function encodeNode(value: unknown): EncodedNode {
  if (value === null) return { k: 'null' };
  if (typeof value === 'boolean') return { k: 'bool', v: value };
  if (typeof value === 'number') return { k: 'num', v: value };
  if (typeof value === 'string') return { k: 'str', v: value };
  if (value instanceof Date) return { k: 'date', v: value.toISOString() };
  if (value instanceof Uint8Array) return { k: 'u8', v: Array.from(value) };
  if (Array.isArray(value)) return { k: 'arr', v: value.map((item) => encodeNode(item)) };
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, EncodedNode> = {};
    for (const [key, child] of Object.entries(obj)) {
      if (child !== undefined) out[key] = encodeNode(child);
    }
    return { k: 'obj', v: out };
  }
  return { k: 'str', v: String(value) };
}

async function encodeBlobNode(blob: Blob): Promise<EncodedNode> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { k: 'blob', mime: blob.type || 'application/octet-stream', bytes: Array.from(bytes) };
}

function decodeNode(node: EncodedNode): unknown {
  switch (node.k) {
    case 'null':
      return null;
    case 'bool':
      return node.v;
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'date':
      return new Date(node.v);
    case 'u8':
      return new Uint8Array(node.v);
    case 'arr':
      return node.v.map((child) => decodeNode(child));
    case 'obj': {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.v)) {
        out[key] = decodeNode(child);
      }
      return out;
    }
    case 'blob':
      return new Blob([new Uint8Array(node.bytes)], { type: node.mime });
    default:
      throw new Error('Unsupported secure-record codec node');
  }
}

async function encodeValueNode(value: unknown): Promise<EncodedNode> {
  if (value instanceof Blob) return encodeBlobNode(value);
  if (Array.isArray(value)) {
    const children = await Promise.all(value.map((item) => encodeValueNode(item)));
    return { k: 'arr', v: children };
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  ) {
    const obj = value as Record<string, unknown>;
    const out: Record<string, EncodedNode> = {};
    for (const [key, child] of Object.entries(obj)) {
      if (child !== undefined) out[key] = await encodeValueNode(child);
    }
    return { k: 'obj', v: out };
  }
  return encodeNode(value);
}

/** Serialize a payload for AES-GCM encryption (preserves Blob bytes). */
export async function encodeSecureRecordValue(value: unknown): Promise<Uint8Array> {
  const root = await encodeValueNode(value);
  const wrapped = { v: CODEC_VERSION, root };
  return new TextEncoder().encode(JSON.stringify(wrapped));
}

/** Deserialize bytes produced by encodeSecureRecordValue. */
export function decodeSecureRecordValue(bytes: Uint8Array): unknown {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    v: number;
    root: EncodedNode;
  };
  if (parsed.v !== CODEC_VERSION) {
    throw new Error(`Unsupported secure-record codec version: ${String(parsed.v)}`);
  }
  return decodeNode(parsed.root);
}
