import { describe, expect, it } from 'vitest';
import { GITHUB_PAGES_BASE, isTauriBuild, resolveViteBase } from '../../config/resolveViteBase';

// QNBS-v3: Guards the desktop discovery regression — a Tauri build that externalized
// @tauri-apps/* left an unresolvable bare module specifier in the shipped bundle (services/
// localServerHttp.ts's dynamic `@tauri-apps/plugin-http` import). isTauriBuild is the single
// source of truth vite.config.ts uses to keep rollupOptions.external in sync with `base`.
describe('isTauriBuild', () => {
  it('is true for Tauri 2.x desktop builds (TAURI_ENV_PLATFORM)', () => {
    expect(isTauriBuild({ TAURI_ENV_PLATFORM: 'linux' })).toBe(true);
  });

  it('is true for the legacy Tauri 1.x env var (TAURI_PLATFORM)', () => {
    expect(isTauriBuild({ TAURI_PLATFORM: 'windows' })).toBe(true);
  });

  it('is false for the web/PWA build with neither env var set', () => {
    expect(isTauriBuild({})).toBe(false);
    expect(isTauriBuild({ VITE_BASE: '/foo', DEPLOY_TARGET: 'edge' })).toBe(false);
  });

  it('is false for an empty-string or whitespace-only marker value (not a real platform)', () => {
    expect(isTauriBuild({ TAURI_ENV_PLATFORM: '' })).toBe(false);
    expect(isTauriBuild({ TAURI_ENV_PLATFORM: '   ' })).toBe(false);
    expect(isTauriBuild({ TAURI_PLATFORM: '' })).toBe(false);
    expect(isTauriBuild({ TAURI_PLATFORM: '   ' })).toBe(false);
  });
});

describe('resolveViteBase', () => {
  it('returns a relative base for Tauri 2.x desktop builds (TAURI_ENV_PLATFORM)', () => {
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'windows' })).toBe('./');
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'darwin' })).toBe('./');
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'linux' })).toBe('./');
  });

  it('returns a relative base for the legacy Tauri 1.x env var (TAURI_PLATFORM)', () => {
    expect(resolveViteBase({ TAURI_PLATFORM: 'windows' })).toBe('./');
  });

  it('does not treat an empty-string TAURI_ENV_PLATFORM as a Tauri build', () => {
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: '' })).toBe(GITHUB_PAGES_BASE);
  });

  it('lets Tauri detection win over VITE_BASE and DEPLOY_TARGET', () => {
    expect(
      resolveViteBase({ TAURI_ENV_PLATFORM: 'windows', VITE_BASE: '/x/', DEPLOY_TARGET: 'edge' }),
    ).toBe('./');
  });

  it('honours an explicit VITE_BASE and normalises the trailing slash', () => {
    expect(resolveViteBase({ VITE_BASE: '/foo' })).toBe('/foo/');
    expect(resolveViteBase({ VITE_BASE: '/foo/' })).toBe('/foo/');
    expect(resolveViteBase({ VITE_BASE: '  /bar  ' })).toBe('/bar/');
  });

  it('returns the root base for edge (Vercel/Cloudflare) deploys', () => {
    expect(resolveViteBase({ DEPLOY_TARGET: 'edge' })).toBe('/');
  });

  it('defaults to the GitHub Pages project base', () => {
    expect(resolveViteBase({})).toBe(GITHUB_PAGES_BASE);
    expect(resolveViteBase({})).toBe('/WorldScript-Studio/');
  });
});
