import { describe, expect, it } from 'vitest';
import { providerToKind } from '../../services/ai/providerFactory';

describe('providerToKind', () => {
  it('maps webllm to unsupported orchestration kind', () => {
    expect(providerToKind('webllm')).toBe('unsupported');
  });
});
