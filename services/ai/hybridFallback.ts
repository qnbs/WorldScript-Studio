import type { AIProvider } from '../../types';

type FallbackOpts = {
  provider: AIProvider;
  hybridFallbackEnabled?: boolean;
  hybridFallbackChain?: AIProvider[];
  fallbackProviders?: AIProvider[];
};

/** QNBS-v3: Primär zuerst, dann konfigurierte Kette — Duplikate entfernt, kompatibel mit altem ollama→gemini-Fallback. */
export function resolveProviderFallbackChain(opts: FallbackOpts): AIProvider[] {
  if (
    opts.hybridFallbackEnabled &&
    opts.hybridFallbackChain &&
    opts.hybridFallbackChain.length > 0
  ) {
    const seen = new Set<AIProvider>();
    const out: AIProvider[] = [];
    for (const p of [opts.provider, ...opts.hybridFallbackChain]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }
  // QNBS-v3: Local inference providers (ollama, webllm, onnx, transformers) can fallback to cloud (gemini).
  const localProviders = new Set(['ollama', 'webllm', 'onnx', 'transformers']);
  if (localProviders.has(opts.provider) && opts.fallbackProviders?.includes('gemini')) {
    return [opts.provider, 'gemini'];
  }
  return [opts.provider];
}
