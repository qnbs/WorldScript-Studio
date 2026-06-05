/**
 * Tests for idbProjectStore.ts — normalizePersistedSettings and state validation.
 * QNBS-v3: P1 tests for uncovered code paths.
 */

import { describe, expect, it } from 'vitest';
import { normalizePersistedSettings } from '../../../../services/storage/idbProjectStore';

describe('idbProjectStore', () => {
  describe('normalizePersistedSettings', () => {
    it('applies defaults for missing top-level fields', () => {
      const result = normalizePersistedSettings({});
      expect(result.theme).toBe('dark');
      expect(result.appearancePreset).toBe('default');
      expect(result.editorFont).toBe('serif');
      expect(result.fontSize).toBe(16);
    });

    it('preserves provided values over defaults', () => {
      const result = normalizePersistedSettings({
        theme: 'light',
        fontSize: 20,
      });
      expect(result.theme).toBe('light');
      expect(result.fontSize).toBe(20);
    });

    it('normalizes accessibility settings with defaults', () => {
      const result = normalizePersistedSettings({
        accessibility: {
          highContrast: true,
        },
      });
      expect(result.accessibility.highContrast).toBe(true);
      // Defaults are applied for missing fields
      expect(result.accessibility.focusIndicators).toBe(true);
    });

    it('normalizes privacy settings with defaults', () => {
      const result = normalizePersistedSettings({
        privacy: {
          analyticsEnabled: true,
        },
      });
      expect(result.privacy.analyticsEnabled).toBe(true);
      expect(result.privacy.dataEncryption).toBe(true);
      expect(result.privacy.localStorageOnly).toBe(true);
    });

    it('normalizes collaboration settings with defaults', () => {
      const result = normalizePersistedSettings({
        collaboration: {
          realTimeCollaboration: true,
        },
      });
      expect(result.collaboration.realTimeCollaboration).toBe(true);
      expect(result.collaboration.commentSystem).toBe(true);
    });

    it('sets default webrtcSignalingUrls when empty', () => {
      const result = normalizePersistedSettings({
        collaboration: {
          webrtcSignalingUrls: [],
        },
      });
      expect(result.collaboration.webrtcSignalingUrls).toHaveLength(2);
    });

    it('preserves provided webrtcSignalingUrls', () => {
      const result = normalizePersistedSettings({
        collaboration: {
          webrtcSignalingUrls: ['https://custom.signal'],
        },
      });
      expect(result.collaboration.webrtcSignalingUrls).toEqual(['https://custom.signal']);
    });

    it('normalizes integrations settings with defaults', () => {
      const result = normalizePersistedSettings({
        integrations: {
          syncProvider: 'evernote',
        },
      });
      expect(result.integrations.syncProvider).toBe('evernote');
      expect(result.integrations.evernoteSync).toBe(false);
    });
  });
});
