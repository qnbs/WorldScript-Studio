// QNBS-v3 (#333 item 1): shared formatting for the two model-download progress UIs
// (LocalAiDownloadProgress, VoiceModelDownloadModal) — kept as pure functions so both can render
// identical "X MB of Y MB" / "Z MB/s" text without duplicating the rounding/formatting logic.

/** Formats a byte count as whole megabytes, e.g. `formatMegabytes(43_000_000)` → `"41"`. */
export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

// QNBS-v3 (#333/CodeRabbit): returns a number, not a locale-formatted string — toFixed() always
// emits a period decimal separator, wrong for comma-decimal locales. Callers format the result with
// formatNumber() from useTranslation() so the decimal separator matches the active UI locale.
/** Converts a bytes-per-second rate to megabytes/sec, rounded to one decimal place. */
export function megabytesPerSecond(bytesPerSecond: number): number {
  return Math.round((bytesPerSecond / (1024 * 1024)) * 10) / 10;
}
