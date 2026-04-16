/**
 * Collaborative Editing Service (Yjs + y-webrtc)
 *
 * P2P real-time collaboration via WebRTC — no backend required.
 * Signaling is done via a free public signaling server.
 *
 * Usage:
 *   collaborationService.connect(projectId, user);
 *   const yText = collaborationService.getSharedText('manuscript');
 *   collaborationService.disconnect();
 */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Awareness } from 'y-protocols/awareness';
import type { CollaborationUser } from '../types';

// Free public signaling servers for y-webrtc
const SIGNALING_SERVERS = ['wss://y-webrtc-signaling.fly.dev'];

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
  async connect(projectId: string, user: CollaborationUser, password?: string): Promise<void> {
    if (this.provider) this.disconnect();

    this._roomId = await this.deriveRoomId(projectId, password);
    this.doc = new Y.Doc();

    this.provider = new WebrtcProvider(this._roomId, this.doc, {
      signaling: SIGNALING_SERVERS,
    });

    // Publish our identity to peers
    this.provider.awareness.setLocalStateField('user', user);

    // Notify all listeners when awareness changes (connected users update)
    this.provider.awareness.on('change', () => {
      this.listeners.forEach((l) => l());
    });
  }

  /** Disconnect and clean up. */
  disconnect(): void {
    this.provider?.disconnect();
    this.provider?.destroy();
    this.doc?.destroy();
    this.provider = null;
    this.doc = null;
    this._roomId = null;
    this.listeners.forEach((l) => l());
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
      if (state['user']) users.push(state['user'] as CollaborationUser);
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
