// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Regression guard for the Permissions-Policy microphone block. `microphone=()` is the
// EMPTY allowlist — it disallows the microphone for every origin, including same-origin. Voice
// (hooks/useMicLevel.ts, hooks/useSpeechRecognition.ts) calls getUserMedia/SpeechRecognition from
// same-origin code, so that header silently killed Whisper STT, push-to-talk, and the mic-level
// meter on Cloudflare Pages + the Docker/nginx image. These assertions lock the fix in place.

const headersFile = readFileSync(
  fileURLToPath(new URL('../../public/_headers', import.meta.url)),
  'utf8',
);
const nginxConf = readFileSync(fileURLToPath(new URL('../../nginx.conf', import.meta.url)), 'utf8');

/** Extract capture group 1 with a narrowing guard (noUncheckedIndexedAccess-safe). */
function group1(m: RegExpMatchArray | null, msg: string): string {
  if (!m || m[1] === undefined) throw new Error(msg);
  return m[1];
}

/** `public/_headers` uses `Key: value` syntax on its own line. */
function headersPolicyValue(): string {
  return group1(
    headersFile.match(/Permissions-Policy:\s*([^\n]*)/),
    'Permissions-Policy must exist in public/_headers',
  ).trim();
}

/** `nginx.conf` sets it via `add_header Permissions-Policy "value" always;`. */
function nginxPolicyValue(): string {
  return group1(
    nginxConf.match(/add_header Permissions-Policy "([^"]*)"/),
    'Permissions-Policy must exist in nginx.conf',
  ).trim();
}

describe('Permissions-Policy — microphone must stay usable same-origin', () => {
  it('public/_headers allows the microphone for self (not an empty allowlist)', () => {
    expect(headersPolicyValue()).toContain('microphone=(self)');
    expect(headersPolicyValue()).not.toMatch(/microphone=\(\)/);
  });

  it('nginx.conf allows the microphone for self (not an empty allowlist)', () => {
    expect(nginxPolicyValue()).toContain('microphone=(self)');
    expect(nginxPolicyValue()).not.toMatch(/microphone=\(\)/);
  });

  it('keeps camera and geolocation restrictive (the app uses neither)', () => {
    for (const value of [headersPolicyValue(), nginxPolicyValue()]) {
      expect(value).toContain('camera=()');
      expect(value).toContain('geolocation=()');
    }
  });

  it('serves the identical Permissions-Policy on Cloudflare Pages and the Docker/nginx image', () => {
    expect(headersPolicyValue()).toBe(nginxPolicyValue());
  });
});
