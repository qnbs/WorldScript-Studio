import { describe, expect, it } from 'vitest';
import {
  assertCspConnectEndpointAllowed,
  CspConnectPolicyError,
  isCspConnectEndpointAllowed,
} from '../../services/network/cspOriginPolicy';

describe('CSP endpoint preflight', () => {
  it('allows an explicitly declared provider origin with a request path', () => {
    expect(() =>
      assertCspConnectEndpointAllowed('https://api.openai.com/v1', 'OpenAI-compatible endpoint'),
    ).not.toThrow();
  });

  it('allows the supported remote LanguageTool origin', () => {
    expect(isCspConnectEndpointAllowed('https://api.languagetool.org/v2/check')).toBe(true);
  });

  it('rejects an arbitrary custom proxy before fetch with an actionable policy error', () => {
    expect(() =>
      assertCspConnectEndpointAllowed(
        'https://writer-proxy.example.test/v1',
        'OpenAI-compatible endpoint',
      ),
    ).toThrow(/blocked.*CSP network policy.*supported origin/i);
  });

  it('rejects credentials and malformed URLs without exposing them in the error', () => {
    expect(() =>
      assertCspConnectEndpointAllowed('https://user:secret@api.openai.com/v1', 'Endpoint'),
    ).toThrow(CspConnectPolicyError);
    expect(() => assertCspConnectEndpointAllowed('not-a-url', 'Endpoint')).toThrow(
      /complete http\(s\) URL/i,
    );
  });
});
