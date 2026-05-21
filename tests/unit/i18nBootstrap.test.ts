import { describe, expect, it } from 'vitest';
import {
  bootstrapTranslation,
  isKnownPersistedTranslationKey,
} from '../../services/i18nBootstrap';

describe('i18nBootstrap', () => {
  it('returns German initial project title before bundle load', () => {
    expect(bootstrapTranslation('de', 'initialProject.title')).toBe(
      'Meine unbenannte Geschichte',
    );
  });

  it('falls back to English for unknown lang keys', () => {
    expect(bootstrapTranslation('fr', 'initialProject.chapter1')).toBe('Chapitre 1');
  });

  it('detects persisted translation keys', () => {
    expect(isKnownPersistedTranslationKey('initialProject.title')).toBe(true);
    expect(isKnownPersistedTranslationKey('My Untitled Story')).toBe(false);
  });
});
