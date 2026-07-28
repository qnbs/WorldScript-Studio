import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: dedicated file — a fresh module registry is required so the mocked
// '@tauri-apps/plugin-http' throws on its FIRST import in this process; sharing a file with tests
// that successfully import it would cache the resolved module and mask this regression class
// (the exact build-config bug fixed alongside this test: see the 2026-07-28 update in
// docs/adr/0012-local-server-connectivity-tauri-http.md).

vi.mock('@tauri-apps/plugin-http', () => {
  throw new Error("Failed to resolve module specifier '@tauri-apps/plugin-http'");
});

vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

import { LocalServerError, localServerFetch } from '../../services/localServerHttp';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localServerFetch (tauri plugin load failure)', () => {
  it('classifies a failed @tauri-apps/plugin-http import as LocalServerError(plugin_unavailable), not unreachable', async () => {
    const err = await localServerFetch('http://localhost:11434/api/tags').catch((e) => e);
    expect(err).toBeInstanceOf(LocalServerError);
    expect(err.kind).toBe('plugin_unavailable');
    expect(err.message).toMatch(/desktop HTTP plugin failed to load/i);
    // The generic web fetch must never be used as a silent fallback for a broken desktop transport.
    expect(fetch).not.toHaveBeenCalled();
  });
});
