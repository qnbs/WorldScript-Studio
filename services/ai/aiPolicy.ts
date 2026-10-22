import type { AIProvider } from '../../types';
import { getActiveAiMode } from './aiModeService';

const LORA_LOCAL_PROVIDERS = new Set(['webllm', 'onnx', 'transformers', 'ollama']);
const LOCAL_INFERENCE_PROVIDERS = new Set(['webllm', 'onnx', 'transformers', 'ollama']);
// QNBS-v3: openrouter is a cloud provider — included in the cloud-gate check below, NOT here.
// Kept separate to make audit clear: local providers never need a key; cloud providers do.

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

/**
 * Sync-Check: the AI execution mode is the single cloud authority (#818). Local and eco modes block
 * every cloud provider; hybrid and cloud allow the providers the user has configured.
 */
export function assertCloudAiAllowedSync(provider: AIProvider): void {
  if (LOCAL_INFERENCE_PROVIDERS.has(provider)) return;
  const mode = getActiveAiMode();
  if (mode === 'local' || mode === 'eco') {
    throw new Error(`Cloud provider blocked: AI mode is "${mode}" (local-only).`);
  }
}

/** Async path kept for existing call sites; the mode is held in memory, so no settings load is needed. */
export async function assertCloudAiAllowed(provider: AIProvider): Promise<void> {
  assertCloudAiAllowedSync(provider);
}
