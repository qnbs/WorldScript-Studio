# LoRA Adapter Inference

**Wiring (C-3):** `AIRequestOptions.loraModelPath?: string` — when set and `provider === 'ollama'`, `streamProvider()` substitutes it as the Ollama model identifier. `selectActiveLoraOllamaTag` (`features/lora/loraSelectors.ts`) returns active adapter's `ollamaModelTag` or null.

**Prerequisite:** `ollama create <tag> -f Modelfile` before setting `ollamaModelTag`. Training is a Python sidecar.

**Gating:** `enableLoraAdapters` flag. UI: Settings → AI → Fine-Tuning.
