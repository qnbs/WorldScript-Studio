import { describe, expect, it } from 'vitest';
import {
  bootstrapTranslation,
  isKnownPersistedTranslationKey,
  resolveTranslation,
} from '../../services/i18nBootstrap';

describe('bootstrapTranslation', () => {
  it('returns German initial project title before bundle load', () => {
    expect(bootstrapTranslation('de', 'initialProject.title')).toBe('Meine unbenannte Geschichte');
  });

  it('returns French chapter 1 label', () => {
    expect(bootstrapTranslation('fr', 'initialProject.chapter1')).toBe('Chapitre 1');
  });

  it('returns Spanish logline', () => {
    expect(bootstrapTranslation('es', 'initialProject.logline')).toContain('mil millas');
  });

  it('returns Italian title', () => {
    expect(bootstrapTranslation('it', 'initialProject.title')).toBe('La mia storia senza titolo');
  });

  it('returns English for ar locale (RTL stub falls back to en)', () => {
    expect(bootstrapTranslation('ar', 'initialProject.title')).toBe('My Untitled Story');
  });

  it('returns English for he locale (RTL stub falls back to en)', () => {
    expect(bootstrapTranslation('he', 'initialProject.chapter1')).toBe('Chapter 1');
  });

  it('falls back to English for an unknown key in any locale', () => {
    expect(bootstrapTranslation('de', 'nonexistent.key')).toBeUndefined();
  });
});

describe('isKnownPersistedTranslationKey', () => {
  it('detects all three persisted keys', () => {
    expect(isKnownPersistedTranslationKey('initialProject.title')).toBe(true);
    expect(isKnownPersistedTranslationKey('initialProject.logline')).toBe(true);
    expect(isKnownPersistedTranslationKey('initialProject.chapter1')).toBe(true);
  });

  it('rejects non-key values', () => {
    expect(isKnownPersistedTranslationKey('My Untitled Story')).toBe(false);
    expect(isKnownPersistedTranslationKey('')).toBe(false);
    expect(isKnownPersistedTranslationKey('some.other.key')).toBe(false);
  });
});

describe('resolveTranslation', () => {
  const loaded: Record<string, unknown> = {
    'initialProject.title': 'Loaded Title',
    'some.key': 'Loaded Value',
  };
  const enLoaded: Record<string, unknown> = {
    'initialProject.title': 'En Loaded Title',
    'fallback.key': 'En Fallback',
  };

  it('returns value from active locale bundle when available', () => {
    expect(resolveTranslation('de', 'initialProject.title', loaded, enLoaded)).toBe('Loaded Title');
  });

  it('falls back to English bundle when active locale is missing key', () => {
    expect(resolveTranslation('de', 'fallback.key', loaded, enLoaded)).toBe('En Fallback');
  });

  it('falls back to bootstrap when both bundles are missing key', () => {
    expect(resolveTranslation('de', 'initialProject.chapter1', {}, {})).toBe('Kapitel 1');
  });

  it('returns key itself when bootstrap also has no value', () => {
    expect(resolveTranslation('en', 'completely.unknown', {}, {})).toBe('completely.unknown');
  });

  it('handles undefined loaded bundles gracefully', () => {
    expect(resolveTranslation('en', 'initialProject.title', undefined, undefined)).toBe(
      'My Untitled Story',
    );
  });

  it('returns ar bootstrap fallback for RTL locale', () => {
    expect(resolveTranslation('ar', 'initialProject.title', undefined, undefined)).toBe(
      'My Untitled Story',
    );
  });
});
