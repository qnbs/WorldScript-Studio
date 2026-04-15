import type { FC } from 'react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { collaborationService } from '../services/collaborationService';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type { CollaborationUser } from '../types';

// Preset user colors for avatar display
const USER_COLORS = [
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#ec4899',
  '#10b981',
  '#3b82f6',
  '#f97316',
  '#84cc16',
];

const getRandomColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

// Persistent user identity for the session
function getLocalUser(): CollaborationUser {
  const stored = sessionStorage.getItem('collab_user');
  if (stored) {
    try {
      return JSON.parse(stored) as CollaborationUser;
    } catch {
      /* ignore */
    }
  }
  const user: CollaborationUser = {
    id: uuid(),
    name: 'Anonym',
    color: getRandomColor(),
  };
  sessionStorage.setItem('collab_user', JSON.stringify(user));
  return user;
}

// ─── User Avatar ──────────────────────────────────────────────────────────────

const UserAvatar: FC<{ user: CollaborationUser; size?: 'sm' | 'md' }> = ({ user, size = 'md' }) => {
  const dim = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
      style={{ backgroundColor: user.color }}
      title={user.name}
      aria-label={`Nutzer: ${user.name}`}
    >
      {user.name.charAt(0).toUpperCase()}
    </div>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface CollaborationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export const CollaborationPanel: FC<CollaborationPanelProps> = ({ isOpen, onClose, projectId }) => {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [localUser, setLocalUser] = useState<CollaborationUser>(getLocalUser);
  const [customRoomId, setCustomRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<CollaborationUser[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [displayName, setDisplayName] = useState(localUser.name);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Focus management + focus trap
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      // Focus the panel container after render
      requestAnimationFrame(() => panelRef.current?.focus());

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
          return;
        }
        if (e.key !== 'Tab') return;
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === panel) {
            last.focus();
            e.preventDefault();
          }
        } else if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
        previousFocusRef.current?.focus();
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen, onClose]);

  // Update user list when awareness changes
  const refreshUsers = useCallback(() => {
    setConnectedUsers(collaborationService.getConnectedUsers());
    setIsConnected(collaborationService.isConnected);
  }, []);

  useEffect(() => {
    const unsubscribe = collaborationService.onUsersChange(refreshUsers);
    return () => {
      unsubscribe();
    };
  }, [refreshUsers]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const [roomPassword, setRoomPassword] = useState('');

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      const roomId = customRoomId.trim() || projectId;
      const user: CollaborationUser = {
        ...localUser,
        name: displayName.trim() || 'Anonym',
      };

      // Persist updated display name
      setLocalUser(user);
      sessionStorage.setItem('collab_user', JSON.stringify(user));

      await collaborationService.connect(roomId, user, roomPassword.trim() || undefined);

      cleanupRef.current = () => collaborationService.disconnect();

      // Small delay for WebRTC handshake
      await new Promise((r) => setTimeout(r, 500));

      setIsConnected(true);
      setConnectedUsers(collaborationService.getConnectedUsers());
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : 'Verbindungsfehler');
    } finally {
      setIsConnecting(false);
    }
  }, [customRoomId, projectId, localUser, displayName, roomPassword]);

  const handleDisconnect = useCallback(() => {
    collaborationService.disconnect();
    cleanupRef.current = null;
    setIsConnected(false);
    setConnectedUsers([]);
  }, []);

  const currentRoomId = collaborationService.roomId ?? `storycraft-${projectId}`;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collab-panel-title"
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-[var(--background-primary)] border-l border-[var(--border-primary)] shadow-2xl z-50 flex flex-col overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-[var(--foreground-secondary)]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
              />
            </svg>
            <h2
              id="collab-panel-title"
              className="text-lg font-bold text-[var(--foreground-primary)]"
            >
              Kollaboration
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Verbunden
              </span>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-[var(--background-secondary)] text-[var(--foreground-secondary)] transition-colors"
              aria-label="Kollaborationspanel schließen"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* How it works */}
          <div className="p-3 rounded-lg bg-[var(--background-interactive)]/10 border border-[var(--border-interactive)]/30 text-sm text-[var(--foreground-secondary)]">
            <p className="font-semibold text-[var(--foreground-primary)] mb-1">
              🌐 P2P Echtzeit-Kollaboration
            </p>
            <p>
              Teile die <strong>Raum-ID</strong> mit deinen Co-Autoren. Alle im gleichen Raum sehen
              Änderungen live — ohne Server.
            </p>
          </div>

          {/* User identity */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Deine Identität
            </h3>
            <div className="flex items-center gap-3">
              <UserAvatar user={{ ...localUser, name: displayName || 'A' }} />
              <div className="flex-1">
                <Input
                  placeholder="Dein Anzeigename"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isConnected}
                />
              </div>
              <div
                className="w-8 h-8 rounded-full cursor-pointer border-2 border-[var(--border-primary)] flex-shrink-0"
                style={{ backgroundColor: localUser.color }}
                title="Farbe (zufällig bei Verbindung)"
              />
            </div>
          </section>

          {/* Room ID */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Raum-ID
            </h3>
            <div className="flex gap-2">
              <Input
                placeholder={`${projectId} (Projekt-ID)`}
                value={customRoomId}
                onChange={(e) => setCustomRoomId(e.target.value)}
                disabled={isConnected}
                className="flex-1 font-mono text-sm"
              />
              {isConnected && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(currentRoomId).catch(() => {});
                  }}
                  className="px-3 py-2 text-xs rounded-md bg-[var(--background-secondary)] hover:bg-[var(--background-tertiary)] text-[var(--foreground-secondary)] border border-[var(--border-primary)] transition-colors"
                  title="In Zwischenablage kopieren"
                >
                  Kopieren
                </button>
              )}
            </div>
            {isConnected && (
              <p className="text-xs text-[var(--foreground-muted)] mt-1">
                Raum: <code className="font-mono">{currentRoomId}</code>
              </p>
            )}
          </section>

          {/* Room Password (PSK) */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Raum-Passwort (optional)
            </h3>
            <Input
              type="password"
              placeholder="Geheimes Passwort für privaten Raum"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              disabled={isConnected}
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs text-[var(--foreground-muted)] mt-1">
              Alle Teilnehmer müssen dasselbe Passwort eingeben, um dem Raum beizutreten.
            </p>
          </section>

          {/* Error */}
          {connectionError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {connectionError}
            </div>
          )}

          {/* Connect/Disconnect */}
          <div>
            {isConnected ? (
              <Button variant="danger" onClick={handleDisconnect} className="w-full">
                Trennen
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={isConnecting} className="w-full">
                {isConnecting ? 'Verbinde …' : 'Verbinden'}
              </Button>
            )}
          </div>

          {/* Connected users */}
          {isConnected && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
                Verbundene Nutzer ({connectedUsers.length})
              </h3>
              {connectedUsers.length === 0 ? (
                <p className="text-sm text-[var(--foreground-muted)]">
                  Warte auf weitere Teilnehmer …
                </p>
              ) : (
                <div className="space-y-2">
                  {connectedUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 p-2 rounded-lg bg-[var(--background-secondary)]"
                    >
                      <UserAvatar user={user} size="sm" />
                      <span className="text-sm text-[var(--foreground-primary)]">{user.name}</span>
                      {user.id === localUser.id && (
                        <span className="ml-auto text-xs text-[var(--foreground-muted)]">(Du)</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Technical note */}
          <div className="p-3 rounded-lg bg-[var(--background-secondary)] text-xs text-[var(--foreground-muted)]">
            <p className="font-semibold mb-1">ℹ️ Technischer Hinweis</p>
            <p>
              Kollaboration nutzt <strong>Yjs + WebRTC</strong> für P2P-Synchronisation. Daten
              werden direkt zwischen Browsern übertragen — kein Server speichert deinen Inhalt.
              Signaling über öffentlichen Free-Tier-Server.
            </p>
          </div>
        </div>
      </section>
    </>
  );
};
