// QNBS-v3 (#333 item 1): shared formatting for the two model-download progress UIs
// (LocalAiDownloadProgress, VoiceModelDownloadModal) — kept as pure functions so both can render
// identical "X MB of Y MB" / "Z MB/s" text without duplicating the rounding/formatting logic.

/** Formats a byte count as whole megabytes, e.g. `formatMegabytes(43_000_000)` → `"41"`. */
export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

/** Formats a bytes-per-second rate as megabytes/sec with one decimal, e.g. `"3.2"`. */
export function formatMegabytesPerSecond(bytesPerSecond: number): string {
  return (bytesPerSecond / (1024 * 1024)).toFixed(1);
}
