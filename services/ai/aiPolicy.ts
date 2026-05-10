import type { AIProvider, PrivacySettings } from '../../types';
import { storageService } from '../storageService';

/** Sync-Check wenn Settings bereits geladen sind (z. B. aus Redux). */
export function assertCloudAiAllowedSync(
  provider: AIProvider,
  privacy: PrivacySettings | undefined,
): void {
  if (provider === 'ollama' || provider === 'webllm') return;
  if (!privacy) return;
  if (privacy.localStorageOnly) {
    throw new Error('Cloud provider blocked: local-only mode is active.');
  }
  if (privacy.euDataResidency && (provider === 'grok' || provider === 'openai')) {
    throw new Error(`Cloud provider blocked by EU residency policy: ${provider}`);
  }
}

/** Async-Pfad wie früher `enforceCloudPolicy` — lädt aktuelle Privacy-Einstellungen aus dem Speicher. */
export async function assertCloudAiAllowed(provider: AIProvider): Promise<void> {
  if (provider === 'ollama' || provider === 'webllm') return;
  const settings = await storageService.loadSettings();
  assertCloudAiAllowedSync(provider, settings?.privacy);
}
