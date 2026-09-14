let lastFallbackReason = '';

export function getLastAiFallbackReason(): string {
  return lastFallbackReason;
}

export function clearLastAiFallbackReason(): void {
  lastFallbackReason = '';
}

export function setLastAiFallbackReason(reason: string): void {
  lastFallbackReason = reason;
}

export function recordProviderSuccess(primary: string, provider: string, index: number): void {
  lastFallbackReason =
    index > 0 ? `Primary provider ${primary} failed; fell back to ${provider}.` : '';
}
