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
