// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractHeadersFileValue,
  extractNginxHeaderValue,
  extractVercelHeaderValue,
  parsePermissionsPolicy,
} from '../utils/deploymentConfigParsers';

// QNBS-v3: Regression guard for the Permissions-Policy microphone block. `microphone=()` is the
// EMPTY allowlist — it disallows the microphone for every origin, including same-origin. Voice
// (hooks/useMicLevel.ts, hooks/useSpeechRecognition.ts) calls getUserMedia/SpeechRecognition from
// same-origin code, so that header silently killed Whisper STT, push-to-talk, and the mic-level
// meter on Vercel, Cloudflare Pages, and the Docker/nginx image. These assertions lock the fix.

const vercelJson = readFileSync(
  fileURLToPath(new URL('../../vercel.json', import.meta.url)),
  'utf8',
);
const headersFile = readFileSync(
  fileURLToPath(new URL('../../public/_headers', import.meta.url)),
  'utf8',
);
const nginxConf = readFileSync(fileURLToPath(new URL('../../nginx.conf', import.meta.url)), 'utf8');

function vercelPolicyValue(): string {
  return extractVercelHeaderValue(vercelJson, 'Permissions-Policy');
}
function headersPolicyValue(): string {
  return extractHeadersFileValue(headersFile, 'Permissions-Policy');
}
function nginxPolicyValue(): string {
  return extractNginxHeaderValue(nginxConf, 'Permissions-Policy');
}

describe('Permissions-Policy — microphone must stay usable same-origin', () => {
  it('allows the microphone for self on all three hosts (exact directive value)', () => {
    // QNBS-v3: assert the exact parsed value, not toContain('microphone=(self)') — that substring
    // check would also pass for a broader allowlist like `microphone=(self https://evil.example)`
    // or a duplicated directive where a later, looser value is the one actually in effect.
    for (const value of [vercelPolicyValue(), headersPolicyValue(), nginxPolicyValue()]) {
      expect(parsePermissionsPolicy(value).get('microphone')).toBe('(self)');
    }
  });

  it('keeps camera and geolocation restrictive with the exact empty-allowlist value', () => {
    for (const value of [vercelPolicyValue(), headersPolicyValue(), nginxPolicyValue()]) {
      const directives = parsePermissionsPolicy(value);
      expect(directives.get('camera')).toBe('()');
      expect(directives.get('geolocation')).toBe('()');
    }
  });

  it('serves the identical Permissions-Policy on Vercel, Cloudflare Pages, and the Docker/nginx image', () => {
    expect(vercelPolicyValue()).toBe(headersPolicyValue());
    expect(headersPolicyValue()).toBe(nginxPolicyValue());
  });
});
