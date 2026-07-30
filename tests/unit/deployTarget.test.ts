import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isServerlessProxyCapable } from '../../services/deployTarget';

describe('isServerlessProxyCapable', () => {
  const originalBaseUrl = import.meta.env.BASE_URL;

  beforeEach(() => {
    import.meta.env.BASE_URL = originalBaseUrl;
  });

  afterEach(() => {
    import.meta.env.BASE_URL = originalBaseUrl;
  });

  it('is true for the edge (Vercel/Cloudflare) root-domain base path', () => {
    import.meta.env.BASE_URL = '/';
    expect(isServerlessProxyCapable()).toBe(true);
  });

  it('is false for the GitHub Pages project-page base path', () => {
    import.meta.env.BASE_URL = '/WorldScript-Studio/';
    expect(isServerlessProxyCapable()).toBe(false);
  });

  it('is true for a custom VITE_BASE deployment (not the GitHub Pages path)', () => {
    import.meta.env.BASE_URL = '/custom-base/';
    expect(isServerlessProxyCapable()).toBe(true);
  });
});
