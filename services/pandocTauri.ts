/**
 * Tauri-side Pandoc call (optional) — returns EPUB bytes or null.
 * QNBS-v3: No shell from the renderer; binary path only in Rust.
 */

export async function tryPandocMarkdownToEpub(markdown: string): Promise<Uint8Array | null> {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: unknown };
  if (!w.__TAURI__) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // QNBS-v3: Tauri 2 liefert strukturiertes JSON — nicht Roh-Base64-String.
    const res = await invoke<{ base64: string }>('pandoc_markdown_to_epub', { markdown });
    const b64 = res?.base64 ?? '';
    if (!b64.trim()) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
