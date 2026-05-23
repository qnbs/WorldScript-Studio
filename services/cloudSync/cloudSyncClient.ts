// QNBS-v3: Cloudflare R2 HTTP client stub — wires up when enableCloudSync flag is on.
// R2 speaks S3-compatible REST; this client targets the Worker-proxied API endpoint
// so no AWS SDK is needed (plain fetch + Bearer token).

export interface CloudSyncConfig {
  /** Worker endpoint or R2 public URL — e.g. https://sync.example.com */
  endpoint: string;
  /** Bearer token issued by the Cloudflare Worker or presigned R2 URL token. */
  token: string;
  /** Logical bucket prefix (defaults to 'sc-sync'). */
  bucketPrefix?: string;
}

export interface CloudSyncObjectMeta {
  key: string;
  size: number;
  lastModified: string;
}

/** Thin HTTP wrapper around the R2 / Worker REST API. */
export class CloudSyncClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly prefix: string;

  constructor(config: CloudSyncConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.token = config.token;
    this.prefix = config.bucketPrefix ?? 'sc-sync';
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/octet-stream',
    };
  }

  private url(key: string): string {
    return `${this.endpoint}/${this.prefix}/${encodeURIComponent(key)}`;
  }

  async put(key: string, body: string): Promise<void> {
    const res = await fetch(this.url(key), {
      method: 'PUT',
      headers: this.headers(),
      body,
    });
    if (!res.ok) throw new Error(`CloudSync PUT failed: ${res.status} ${res.statusText}`);
  }

  async get(key: string): Promise<string | null> {
    const res = await fetch(this.url(key), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CloudSync GET failed: ${res.status} ${res.statusText}`);
    return res.text();
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(this.url(key), { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404)
      throw new Error(`CloudSync DELETE failed: ${res.status} ${res.statusText}`);
  }

  async list(prefix?: string): Promise<CloudSyncObjectMeta[]> {
    const url = `${this.endpoint}/${this.prefix}/?list${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`CloudSync LIST failed: ${res.status} ${res.statusText}`);
    return res.json() as Promise<CloudSyncObjectMeta[]>;
  }
}
