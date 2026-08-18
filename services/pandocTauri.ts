/**
 * Tauri-side Pandoc call (optional) — returns EPUB bytes or null.
 * QNBS-v3: No shell from the renderer; binary path only in Rust.
 */

import { desktopPlatform } from './desktopPlatform';

// QNBS-v3: Wave 1 PR B — routes through desktopPlatform.runtime.isDesktop (backed by tauriRuntime.ts's
// isTauriRuntime(), which checks __TAURI_INTERNALS__) instead of the previous raw window.__TAURI__
// check, which was already stale for Tauri v2's opt-in __TAURI__ global.
export async function tryPandocMarkdownToEpub(markdown: string): Promise<Uint8Array | null> {
  if (!desktopPlatform.runtime.isDesktop) return null;
  return desktopPlatform.tasks.convertMarkdownToEpub(markdown);
}
