import { describe, expect, it } from 'vitest';
import { GITHUB_PAGES_BASE, resolveViteBase } from '../../config/resolveViteBase';

// QNBS-v3: Guards the desktop blank-screen regression — Tauri builds MUST resolve to a relative
// base so hashed assets load under tauri://localhost/ instead of 404ing on the GitHub Pages path.
describe('resolveViteBase', () => {
  it('returns a relative base for Tauri 2.x desktop builds (TAURI_ENV_PLATFORM)', () => {
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'windows' })).toBe('./');
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'darwin' })).toBe('./');
    expect(resolveViteBase({ TAURI_ENV_PLATFORM: 'linux' })).toBe('./');
  });

  it('returns a relative base for the legacy Tauri 1.x env var (TAURI_PLATFORM)', () => {
    expect(resolveViteBase({ TAURI_PLATFORM: 'windows' })).toBe('./');
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
