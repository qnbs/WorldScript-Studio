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
          languageToolEnabled: true,
        },
      });
      expect(result.integrations.languageToolEnabled).toBe(true);
      expect(result.integrations.languageToolBaseUrl).toBe('http://localhost:8010');
    });

    it('applies voice defaults when voice is missing', () => {
      const result = normalizePersistedSettings({});
      expect(typeof result.voice).toBe('object');
      expect(result.voice).not.toBeNull();
    });

    it('applies advancedAi defaults when advancedAi is missing', () => {
      const result = normalizePersistedSettings({});
      expect(result.advancedAi.provider).toBe('gemini');
      expect(result.advancedAi.temperature).toBe(0.7);
      expect(result.advancedAi.ragMode).toBe('hybrid');
    });

    it('normalizes keyboardShortcuts to array when missing', () => {
      const result = normalizePersistedSettings({});
      expect(Array.isArray(result.keyboardShortcuts)).toBe(true);
    });

    it('normalizes writingGoals to array when missing', () => {
      const result = normalizePersistedSettings({});
      expect(Array.isArray(result.writingGoals)).toBe(true);
      expect(result.writingGoals.length).toBeGreaterThan(0);
    });
  });
});
