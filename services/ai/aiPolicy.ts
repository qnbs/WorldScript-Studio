import type { AIProvider, PrivacySettings } from '../../types';
import { storageService } from '../storageService';

const LORA_LOCAL_PROVIDERS = new Set(['webllm', 'onnx', 'transformers', 'ollama']);

/**
 * Throws if the given model/provider is cloud-hosted.
 * QNBS-v3: Hard gate — training data (manuscript) must never leave the device.
 */
export function assertLoraLocalOnly(modelIdOrProvider: string): void {
  // If it looks like a provider name, check against the allow-list
  if (LORA_LOCAL_PROVIDERS.has(modelIdOrProvider)) return;
  // Unsloth model IDs start with "unsloth/" — also local
  if (modelIdOrProvider.startsWith('unsloth/')) return;
  // HuggingFace model IDs without a cloud prefix are downloaded locally
  if (!modelIdOrProvider.includes('googleapis') && !modelIdOrProvider.includes('openai')) return;
  throw new Error(
    `LoRA training blocked: model "${modelIdOrProvider}" appears to be cloud-hosted. Only local models (Ollama, WebLLM, Unsloth) are allowed for training.`,
  );
}

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
