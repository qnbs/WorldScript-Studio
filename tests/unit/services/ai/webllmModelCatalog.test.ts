// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { WEBLLM_MODEL_APPROX_MB, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import { describe, expect, it } from 'vitest';
import type { DeviceHealthReport } from '../../../../services/ai/deviceHealthService';
import { getModelRecommendation } from '../../../../services/ai/deviceHealthService';
import { getModelRecommendationForTask } from '../../../../services/ai/modelRecommendations';

const root = join(__dirname, '..', '..', '..', '..');

// The engine is created without a custom appConfig, so web-llm resolves every model id against its
// own prebuiltAppConfig and throws ModelNotFoundError for anything else. Read that list from the
// installed runtime of @domain/ai-core instead of keeping a second copy here.
function prebuiltModelIds(): Set<string> {
  const requireFromAiCore = createRequire(join(root, 'packages/ai-core/package.json'));
  const source = readFileSync(requireFromAiCore.resolve('@mlc-ai/web-llm'), 'utf8');
  return new Set(
    Array.from(source.matchAll(/model_id:\s*"([^"]+)"/g), (match) => match[1] as string),
  );
}

const supportedIds = WEBLLM_SUPPORTED_MODELS.map((model) => model.id);

function report(gpuVramTier: DeviceHealthReport['gpuVramTier']): DeviceHealthReport {
  return { gpuVramTier } as DeviceHealthReport;
}

describe('WebLLM model catalogue', () => {
  it('reads a non-trivial prebuilt model list from the installed runtime', () => {
    expect(prebuiltModelIds().size).toBeGreaterThan(20);
  });

  it('offers only models the installed web-llm runtime can load', () => {
    const prebuilt = prebuiltModelIds();
    expect(supportedIds.filter((id) => !prebuilt.has(id))).toEqual([]);
  });

  it('has a size estimate for every offered model', () => {
    expect(Object.keys(WEBLLM_MODEL_APPROX_MB).sort()).toEqual([...supportedIds].sort());
  });

  it('recommends only offered models for every VRAM tier', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(supportedIds).toContain(getModelRecommendation('text-gen', report(tier)));
      expect(supportedIds).toContain(
        getModelRecommendationForTask('text-gen', report(tier)).webllm,
      );
    }
  });
});
