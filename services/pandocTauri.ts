/**
 * Tauri-side Pandoc call (optional) — returns EPUB bytes or null.
 * QNBS-v3: No shell from the renderer; binary path only in Rust.
 */

import { desktopPlatform } from './desktopPlatform';

// QNBS-v3: routes through desktopPlatform.runtime.isDesktop instead of the stale raw window.__TAURI__ check (already outdated for Tauri v2's opt-in __TAURI__ global).
export async function tryPandocMarkdownToEpub(markdown: string): Promise<Uint8Array | null> {
  if (!desktopPlatform.runtime.isDesktop) return null;
  return desktopPlatform.tasks.convertMarkdownToEpub(markdown);
}
