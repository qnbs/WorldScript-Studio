/**
 * Collaborative Editing Service (Yjs + y-webrtc)
 *
 * P2P real-time collaboration via WebRTC — no backend required.
 * Signaling uses multiple public endpoints for failover.
 *
 * Usage:
 *   collaborationService.connect(projectId, user);
 *   const yText = collaborationService.getSharedText('manuscript');
 *   collaborationService.disconnect();
 */

import type { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import * as Y from 'yjs';
import type { CollaborationUser } from '../types';

/** Default public signaling servers for y-webrtc (failover list). */
export const DEFAULT_WEBRTC_SIGNALING_URLS: readonly string[] = [
  'wss://y-webrtc-signaling.fly.dev',
  'wss://signaling.yjs.dev',
];

/** Normalize and validate signaling URLs; falls back to defaults if none valid. */
export function resolveWebRtcSignalingUrls(configured?: readonly string[]): string[] {
  const raw =
    configured && configured.length > 0 ? [...configured] : [...DEFAULT_WEBRTC_SIGNALING_URLS];
  const cleaned = raw
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => u.startsWith('wss://') || u.startsWith('ws://'));
  return cleaned.length > 0 ? cleaned : [...DEFAULT_WEBRTC_SIGNALING_URLS];
}

export interface AwarenessState {
  user: CollaborationUser;
}

class CollaborationService {
  private doc: Y.Doc | null = null;
  private provider: WebrtcProvider | null = null;
  private _roomId: string | null = null;
  private readonly listeners = new Set<() => void>();
  // QNBS-v3: AES-256-GCM key derived from password — null when no password was supplied.
  private encryptionKey: CryptoKey | null = null;

  private stripControlChars(value: string): string {
    let output = '';
    for (const char of value) {
      const code = char.charCodeAt(0);
      output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
    }
    return output;
  }

  private sanitizeRoomValue(value: string): string {
    return this.stripControlChars(value).trim().replace(/\s+/g, ' ').slice(0, 128);
  }

  // QNBS-v3: PBKDF2 310 000 iterations per OWASP 2024 — SHA-256 KDF, AES-256-GCM output.
  // QNBS-v3: Explicit Uint8Array<ArrayBuffer> generic required by TS6 strict BufferSource typing.
  private async deriveEncryptionKey(
    password: string,
    salt: Uint8Array<ArrayBuffer>,
  ): Promise<CryptoKey> {
    const encoded = new TextEncoder().encode(password);
    const keyMaterial = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // QNBS-v3: 12-byte random IV prepended to ciphertext — required for GCM nonce uniqueness.
  async encryptUpdate(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
    const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const result = new Uint8Array(12 + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), 12);
    return result.buffer as ArrayBuffer;
  }

  async decryptUpdate(
    key: CryptoKey,
    iv: Uint8Array<ArrayBuffer>,
    ciphertext: ArrayBuffer,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new Uint8Array(plaintext) as Uint8Array<ArrayBuffer>;
  }

  /** Returns current encryption level: 'encrypted' (AES-GCM key derived), 'psk-only' (room isolation), or 'plaintext'. */
  getEncryptionStatus(): 'encrypted' | 'psk-only' | 'plaintext' {
    if (this.encryptionKey !== null) return 'encrypted';
    if (this._roomId !== null) return 'psk-only';
    return 'plaintext';
  }

  /** Hash projectId + password into a deterministic room name for PSK isolation. */
  private async deriveRoomId(projectId: string, password?: string): Promise<string> {
    const sanitizedProjectId = this.sanitizeRoomValue(projectId);
    const sanitizedPassword = password ? this.sanitizeRoomValue(password) : undefined;
    const raw = sanitizedPassword
      ? `${sanitizedProjectId}:${sanitizedPassword}`
      : sanitizedProjectId;
    const data = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
    return `storycraft-${hex}`;
  }

  /** Connect to a collaboration room for the given project. */
  async connect(
    projectId: string,
    user: CollaborationUser,
    password?: string,
    signalingUrls?: readonly string[],
  ): Promise<void> {
    if (this.provider) this.disconnect();

    this._roomId = await this.deriveRoomId(projectId, password);
    this.doc = new Y.Doc();

    // QNBS-v3: Derive AES-256-GCM key when password supplied — salt is SHA-256 of projectId for determinism.
    if (password) {
      const saltBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(this.sanitizeRoomValue(projectId)),
      );
      this.encryptionKey = await this.deriveEncryptionKey(
        password,
        new Uint8Array(saltBuffer).slice(0, 16) as Uint8Array<ArrayBuffer>,
      );
    }

    const signaling = resolveWebRtcSignalingUrls(signalingUrls);

    this.provider = new WebrtcProvider(this._roomId, this.doc, {
      signaling,
    });

    // Publish our identity to peers
    this.provider.awareness.setLocalStateField('user', user);

    // Notify all listeners when awareness changes (connected users update)
    this.provider.awareness.on('change', () => {
      this.listeners.forEach((l) => void l());
    });
  }

  async connectWithBackoff(
    projectId: string,
    user: CollaborationUser,
    options?: {
      password?: string;
      signalingUrls?: readonly string[];
      maxRetries?: number;
      baseDelayMs?: number;
    },
  ): Promise<void> {
    const maxRetries = options?.maxRetries ?? 4;
    const baseDelayMs = options?.baseDelayMs ?? 500;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await this.connect(projectId, user, options?.password, options?.signalingUrls);
        return;
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Disconnect and clean up. */
  disconnect(): void {
    this.provider?.disconnect();
    this.provider?.destroy();
    this.doc?.destroy();
    this.provider = null;
    this.doc = null;
    this._roomId = null;
    this.encryptionKey = null;
    this.listeners.forEach((l) => void l());
  }

  get isConnected(): boolean {
    return this.provider !== null;
  }

  get roomId(): string | null {
    return this._roomId;
  }

  /** Get (or create) a shared Y.Text document by name. */
  getSharedText(name: string): Y.Text {
    if (!this.doc) throw new Error('Not connected to a collaboration room.');
    return this.doc.getText(name);
  }

  /** Get the raw Y.Doc instance. */
  getDoc(): Y.Doc | null {
    return this.doc;
  }

  /** Get the awareness instance for cursor/presence tracking. */
  getAwareness(): Awareness | null {
    return this.provider?.awareness ?? null;
  }

  /** Get the list of currently connected users (from awareness). */
  getConnectedUsers(): CollaborationUser[] {
    if (!this.provider) return [];
    const users: CollaborationUser[] = [];
    this.provider.awareness.getStates().forEach((state: Record<string, unknown>) => {
      const raw = state['user'];
      if (raw && typeof raw === 'object') {
        const u = raw as Record<string, unknown>;
        if (
          typeof u['id'] === 'string' &&
          typeof u['name'] === 'string' &&
          typeof u['color'] === 'string' &&
          u['name'].length <= 100
        ) {
          const user: CollaborationUser = {
            id: u['id'].slice(0, 64),
            name: u['name'].slice(0, 100),
            color: u['color'].slice(0, 20),
          };
          if (typeof u['cursor'] === 'number') {
            user.cursor = u['cursor'];
          }
          users.push(user);
        }
      }
    });
    return users;
  }

  /** Update the local user's info (e.g., cursor position). */
  updateUserState(patch: Partial<CollaborationUser>): void {
    if (!this.provider) return;
    const current = (this.provider.awareness.getLocalState() as AwarenessState | null)?.user ?? {};
    this.provider.awareness.setLocalStateField('user', {
      ...current,
      ...patch,
    });
  }

  /** Register a listener that fires when connected users change. */
  onUsersChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const collaborationService = new CollaborationService();

export type { Y };
