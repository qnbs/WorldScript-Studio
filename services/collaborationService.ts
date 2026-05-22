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
  // QNBS-v3: Cache of decrypted peer users — refreshed async after each awareness change in encrypted mode.
  private _decryptedUsers: CollaborationUser[] = [];
  // QNBS-v3: Local copy of current user for state merging when awareness is encrypted (avoids reading __enc blob from awareness).
  private _localUser: CollaborationUser | null = null;

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

  // QNBS-v3: Serialize CollaborationUser to JSON, encrypt with AES-256-GCM, base64-encode for y-webrtc awareness transport.
  private async _encryptAwarenessPayload(user: CollaborationUser): Promise<string> {
    const data = new TextEncoder().encode(JSON.stringify(user)) as Uint8Array<ArrayBuffer>;
    const encrypted = await this.encryptUpdate(this.encryptionKey as CryptoKey, data);
    const bytes = new Uint8Array(encrypted);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  // QNBS-v3: Decrypt base64-encoded AES-256-GCM awareness payload; returns null on tampered/wrong-key input.
  private async _decryptAwarenessPayload(encoded: string): Promise<CollaborationUser | null> {
    if (!this.encryptionKey) return null;
    try {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const iv = bytes.slice(0, 12) as Uint8Array<ArrayBuffer>;
      const ciphertext = bytes.slice(12).buffer as ArrayBuffer;
      const decrypted = await this.decryptUpdate(this.encryptionKey, iv, ciphertext);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
      if (!parsed || typeof parsed !== 'object') return null;
      return this._validateUser(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /** Validate and sanitize a raw awareness user object; returns null if required fields are missing or invalid. */
  private _validateUser(u: Record<string, unknown>): CollaborationUser | null {
    if (
      typeof u['id'] !== 'string' ||
      typeof u['name'] !== 'string' ||
      typeof u['color'] !== 'string' ||
      u['name'].length > 100
    ) {
      return null;
    }
    const user: CollaborationUser = {
      id: u['id'].slice(0, 64),
      name: u['name'].slice(0, 100),
      color: u['color'].slice(0, 20),
    };
    if (typeof u['cursor'] === 'number') {
      user.cursor = u['cursor'];
    }
    return user;
  }

  // QNBS-v3: Set local awareness user state — encrypts with AES-256-GCM when encryptionKey is active, plain object otherwise.
  private async _setAwarenessUser(user: CollaborationUser): Promise<void> {
    if (!this.provider) return;
    if (this.encryptionKey) {
      const payload = await this._encryptAwarenessPayload(user);
      this.provider.awareness.setLocalStateField('user', { __enc: payload });
    } else {
      this.provider.awareness.setLocalStateField('user', user);
    }
  }

  // QNBS-v3: Rebuild decrypted-users cache from current awareness states — called async after each awareness change in encrypted mode.
  private async _refreshDecryptedUsers(): Promise<void> {
    if (!this.provider) {
      this._decryptedUsers = [];
      return;
    }
    const entries: Record<string, unknown>[] = [];
    this.provider.awareness.getStates().forEach((state: Record<string, unknown>) => {
      const raw = state['user'];
      if (raw && typeof raw === 'object') entries.push(raw as Record<string, unknown>);
    });

    const resolved: CollaborationUser[] = [];
    for (const raw of entries) {
      let user: CollaborationUser | null;
      if ('__enc' in raw && typeof raw['__enc'] === 'string') {
        user = await this._decryptAwarenessPayload(raw['__enc']);
      } else {
        user = this._validateUser(raw);
      }
      if (user) resolved.push(user);
    }
    this._decryptedUsers = resolved;
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
    this._localUser = user;
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

    // QNBS-v3: opt-in E2E — only when roomPassword is set. y-webrtc derives AES-GCM-256 from password
    // internally; all WebRTC messages are encrypted before leaving the browser.
    this.provider = new WebrtcProvider(this._roomId, this.doc, {
      signaling,
      ...(password ? { password: this.sanitizeRoomValue(password) } : {}),
    });

    // Publish our identity to peers — AES-256-GCM encrypted when password is set.
    await this._setAwarenessUser(user);

    // Notify all listeners when awareness changes (connected users update)
    this.provider.awareness.on('change', () => {
      if (this.encryptionKey) {
        // QNBS-v3: decrypt peer awareness states async before notifying UI — prevents plaintext user data leaking in encrypted rooms.
        void this._refreshDecryptedUsers().then(() => {
          this.listeners.forEach((l) => void l());
        });
      } else {
        this.listeners.forEach((l) => void l());
      }
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
    this._localUser = null;
    this._decryptedUsers = [];
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
    // QNBS-v3: Encrypted mode returns pre-decrypted cache; plaintext mode reads awareness synchronously.
    if (this.encryptionKey) return this._decryptedUsers;
    const users: CollaborationUser[] = [];
    this.provider.awareness.getStates().forEach((state: Record<string, unknown>) => {
      const raw = state['user'];
      if (raw && typeof raw === 'object') {
        const user = this._validateUser(raw as Record<string, unknown>);
        if (user) users.push(user);
      }
    });
    return users;
  }

  /** Update the local user's info (e.g., cursor position). */
  updateUserState(patch: Partial<CollaborationUser>): void {
    if (!this.provider) return;
    // QNBS-v3: Use cached _localUser for merging — avoids reading encrypted __enc state from awareness.
    const base: CollaborationUser = this._localUser ?? { id: '', name: '', color: '' };
    const merged: CollaborationUser = { ...base, ...patch };
    this._localUser = merged;
    void this._setAwarenessUser(merged);
  }

  /** Register a listener that fires when connected users change. */
  onUsersChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const collaborationService = new CollaborationService();
