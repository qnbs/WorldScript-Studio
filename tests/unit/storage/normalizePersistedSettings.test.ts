/**
 * Tests for normalizePersistedSettings — the IDB rehydration migration guard.
 * Verifies that old / partial settings objects (pre-v1.8) are upgraded to the
 * current shape without crashing, preventing startup errors like
 * "Cannot read properties of undefined (reading 'highContrast')".
 */
import { describe, expect, it, vi } from 'vitest';

// Mock modules that access document/window at import time
vi.mock('../../../features/settings/settingsSlice', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/settings/settingsSlice')>();
  return {
    ...mod,
    applyInitialTheme: vi.fn(),
  };
});
vi.mock('../../../services/collaborationService', () => ({
  DEFAULT_WEBRTC_SIGNALING_URLS: ['wss://signaling.yjs.dev'],
}));
vi.mock('../../../services/storage/storageEncryptionService', () => ({
  isIdbEncryptionReady: () => false,
  isEncryptedBlob: () => false,
}));

import { normalizePersistedSettings } from '../../../services/storage/idbProjectStore';

describe('normalizePersistedSettings', () => {
  // ── accessibility ─────────────────────────────────────────────────────────

  it('provides accessibility defaults when field is absent (pre-v1.8 settings)', () => {
    const result = normalizePersistedSettings({ theme: 'dark' });
    expect(result.accessibility).toBeDefined();
    expect(result.accessibility.highContrast).toBe(false);
    expect(result.accessibility.reducedMotion).toBe(false);
    expect(result.accessibility.focusIndicators).toBe(true);
    expect(result.accessibility.colorBlindMode).toBe('none');
  });

  it('preserves existing accessibility values', () => {
    const result = normalizePersistedSettings({
      accessibility: { highContrast: true, reducedMotion: true, focusIndicators: false },
    });
    expect(result.accessibility.highContrast).toBe(true);
    expect(result.accessibility.reducedMotion).toBe(true);
    expect(result.accessibility.focusIndicators).toBe(false);
    // Missing fields get defaults
    expect(result.accessibility.largeText).toBe(false);
  });

  // ── keyboardShortcuts ─────────────────────────────────────────────────────

  it('provides default keyboard shortcuts when field is absent', () => {
    const result = normalizePersistedSettings({ theme: 'light' });
    expect(Array.isArray(result.keyboardShortcuts)).toBe(true);
    expect(result.keyboardShortcuts.length).toBeGreaterThan(0);
    // All entries must have action and keys
    for (const s of result.keyboardShortcuts) {
      expect(typeof s.action).toBe('string');
      expect(Array.isArray(s.keys)).toBe(true);
    }
  });

  it('preserves existing keyboard shortcuts when provided', () => {
    const custom = [{ id: 'custom-1', action: 'save', keys: ['Ctrl', 'S'] }];
    const result = normalizePersistedSettings({ keyboardShortcuts: custom });
    expect(result.keyboardShortcuts).toEqual(custom);
  });

  // ── writingGoals ──────────────────────────────────────────────────────────

  it('provides default writing goals when field is absent', () => {
    const result = normalizePersistedSettings({});
    expect(Array.isArray(result.writingGoals)).toBe(true);
    expect(result.writingGoals.length).toBeGreaterThan(0);
  });

  // ── voice ─────────────────────────────────────────────────────────────────

  it('provides default voice settings when field is absent', () => {
    const result = normalizePersistedSettings({});
    expect(result.voice).toBeDefined();
    expect(result.voice.enabled).toBe(false);
    expect(typeof result.voice.sttEngine).toBe('string');
  });

  it('provides default voice settings when field is null', () => {
    const result = normalizePersistedSettings({ voice: null });
    expect(result.voice).toBeDefined();
    expect(result.voice.enabled).toBe(false);
  });

  // ── backup ────────────────────────────────────────────────────────────────

  it('provides default backup settings when field is absent', () => {
    const result = normalizePersistedSettings({});
    expect(result.backup).toBeDefined();
    expect(result.backup.autoBackup).toBe(true);
    expect(result.backup.maxBackups).toBe(10);
  });

  // ── performance ───────────────────────────────────────────────────────────

  it('provides default performance settings when field is absent', () => {
    const result = normalizePersistedSettings({});
    expect(result.performance).toBeDefined();
    expect(result.performance.autoSaveInterval).toBe(30);
  });

  // ── privacy ───────────────────────────────────────────────────────────────

  it('provides default privacy settings when field is absent (analytics ON, migrated)', () => {
    const result = normalizePersistedSettings({});
    expect(result.privacy).toBeDefined();
    expect(result.privacy.localStorageOnly).toBe(true);
    // QNBS-v3: SEC — default analytics ON (local-only metadata); fresh data is treated as migrated.
    expect(result.privacy.analyticsEnabled).toBe(true);
    expect(result.privacy.analyticsGateMigrated).toBe(true);
  });

  it('merges partial privacy settings with defaults', () => {
    const result = normalizePersistedSettings({
      privacy: { analyticsEnabled: true, analyticsGateMigrated: true },
    });
    expect(result.privacy.analyticsEnabled).toBe(true);
    expect(result.privacy.localStorageOnly).toBe(true); // default preserved
  });

  // QNBS-v3: SEC one-time migration — legacy persisted analyticsEnabled was cosmetic (the gate didn't
  // exist; analytics ran whenever enableDuckDbAnalytics was on, which is the default). On first upgrade
  // we reset to the new default to PRESERVE prior behavior, then respect the user's choice thereafter.
  it('migrates legacy persisted analyticsEnabled:false (no marker) to ON, preserving prior behavior', () => {
    const result = normalizePersistedSettings({ privacy: { analyticsEnabled: false } });
    expect(result.privacy.analyticsEnabled).toBe(true);
    expect(result.privacy.analyticsGateMigrated).toBe(true);
  });

  it('respects a genuine opt-out (analyticsEnabled:false) once the migration marker is set', () => {
    const result = normalizePersistedSettings({
      privacy: { analyticsEnabled: false, analyticsGateMigrated: true },
    });
    expect(result.privacy.analyticsEnabled).toBe(false);
    expect(result.privacy.analyticsGateMigrated).toBe(true);
  });

  // ── advancedAi ────────────────────────────────────────────────────────────

  it('provides advancedAi defaults when field is absent', () => {
    const result = normalizePersistedSettings({});
    expect(result.advancedAi).toBeDefined();
    expect(result.advancedAi.provider).toBe('gemini');
    expect(Array.isArray(result.advancedAi.hybridFallbackChain)).toBe(true);
  });

  it('merges partial advancedAi with defaults', () => {
    const result = normalizePersistedSettings({ advancedAi: { provider: 'openai' } });
    expect(result.advancedAi.provider).toBe('openai');
    expect(result.advancedAi.temperature).toBe(0.7); // default preserved
  });

  // ── collaboration ─────────────────────────────────────────────────────────

  it('provides default collaboration signaling URLs when empty', () => {
    const result = normalizePersistedSettings({ collaboration: { webrtcSignalingUrls: [] } });
    expect(result.collaboration.webrtcSignalingUrls.length).toBeGreaterThan(0);
  });

  it('preserves non-empty signaling URLs', () => {
    const urls = ['wss://custom.signal.server'];
    const result = normalizePersistedSettings({
      collaboration: { webrtcSignalingUrls: urls },
    });
    expect(result.collaboration.webrtcSignalingUrls).toEqual(urls);
  });

  // ── theme / basic fields ──────────────────────────────────────────────────

  it('preserves theme from incoming settings', () => {
    const result = normalizePersistedSettings({ theme: 'sepia' });
    expect(result.theme).toBe('sepia');
  });

  it('applies default theme when absent', () => {
    const result = normalizePersistedSettings({});
    expect(result.theme).toBe('dark');
  });

  // ── fully absent settings (completely old project) ────────────────────────

  it('handles completely empty incoming object without throwing', () => {
    expect(() => normalizePersistedSettings({})).not.toThrow();
    const result = normalizePersistedSettings({});
    // All required array fields must be arrays
    expect(Array.isArray(result.keyboardShortcuts)).toBe(true);
    expect(Array.isArray(result.writingGoals)).toBe(true);
    // All required object fields must be objects
    expect(typeof result.accessibility).toBe('object');
    expect(typeof result.voice).toBe('object');
    expect(typeof result.backup).toBe('object');
    expect(typeof result.performance).toBe('object');
    expect(typeof result.privacy).toBe('object');
    expect(typeof result.advancedAi).toBe('object');
    expect(typeof result.collaboration).toBe('object');
  });
});
