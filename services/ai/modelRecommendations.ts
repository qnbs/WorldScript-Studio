/** QNBS-v3: Kuratierte Hinweise — keine Download-/Pflicht-Modelle; Nutzer prüft Namen in der jeweiligen GUI (Ollama/LM Studio). */

export const RECOMMENDED_OLLAMA_MODEL_IDS = [
  'qwen3:8b',
  'llama3.3',
  'mistral',
  'gemma3',
  'deepseek-r1:7b',
] as const;

export const RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT =
  'OpenRouter/Groq/Azure OpenAI: Basis-URL + Modell-ID wie beim Anbieter dokumentiert (Stand 2026 — Preise/SLAs auf der Anbieterseite prüfen).';
