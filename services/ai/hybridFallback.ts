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
  if (
    (opts.provider === 'ollama' || opts.provider === 'webllm') &&
    opts.fallbackProviders?.includes('gemini')
  ) {
    return opts.provider === 'webllm' ? ['webllm', 'gemini'] : ['ollama', 'gemini'];
  }
  return [opts.provider];
}
