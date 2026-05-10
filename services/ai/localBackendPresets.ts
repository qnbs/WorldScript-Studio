import type { LocalBackendPreset } from '../../types';

/** QNBS-v3: Einheitliche Default-Ports für LM Studio / vLLM — Nutzer kann unter „custom“ beliebig anpassen. */
export const LOCAL_BACKEND_PRESET_DEFAULT_URL: Record<LocalBackendPreset, string> = {
  ollama_default: 'http://localhost:11434',
  lm_studio: 'http://localhost:1234',
  vllm: 'http://localhost:8000',
  custom: 'http://localhost:11434',
};
